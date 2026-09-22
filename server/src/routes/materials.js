import { Router } from 'express';
import { z } from 'zod';
import { Course, CourseAssignment, CourseMaterial, Student } from '../db/mongo/models.js';
import { plain } from '../db/mongo/query.js';
import { oid } from '../db/mongo/connection.js';
import { asyncHandler, ok, created } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import path from 'node:path';
import fs from 'node:fs';
import env from '../config/env.js';
import { materialUpload, publicPath, deleteUpload } from '../middleware/upload.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import { sameId } from '../lib/scope.js';
import {
  isAdmin, isTeacher, isStudent, isParent, facultyIdOf, teacherOwnsCourse, studentIdOf, childrenOf,
} from '../lib/scope.js';
import { notifyMany } from '../lib/notify.js';

const router = Router();

/**
 * Material visibility.
 *   Teacher  -> only material for courses assigned to them
 *   Student  -> published material for their own class
 *   Parent   -> published material for their children's classes
 */
/** See the note in mentoring.js: this is what `1 = 0` said. */
const NONE = { $expr: { $eq: [1, 0] } };

/**
 * A pupil's and a parent's view is filtered by the *course's* class, which is
 * a field on another collection. The SQL reached it through the join; here the
 * courses of that class are found first and the material narrowed to them.
 */
const coursesOfClasses = async (classIds) => {
  const ids = classIds.map(oid).filter(Boolean);
  if (!ids.length) return [];
  const rows = await Course.find({ class_id: { $in: ids } }).select('_id').lean();
  return rows.map((r) => r._id);
};

async function materialScope(req) {
  if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return null;

  if (isTeacher(req.user)) {
    const facultyId = await facultyIdOf(req.user);
    if (!facultyId) return NONE;
    // Their own material, or material for a course they are assigned to.
    const assigned = await CourseAssignment.find({ faculty_id: oid(facultyId), status: 'ACTIVE' })
      .select('course_id').lean();
    return {
      $or: [
        { faculty_id: oid(facultyId) },
        { course_id: { $in: assigned.map((a) => a.course_id).filter(Boolean) } },
      ],
    };
  }

  if (isStudent(req.user)) {
    const student = await Student.findOne({ user_id: oid(req.user.id) })
      .select('class_id section_id').lean();
    if (!student) return NONE;
    const courses = await coursesOfClasses([student.class_id]);
    if (!courses.length) return NONE;
    return {
      is_published: 1,
      course_id: { $in: courses },
      // Material for the whole class, or for this pupil's own section.
      $or: [{ section_id: null }, { section_id: student.section_id ?? null }],
    };
  }

  if (isParent(req.user)) {
    const children = await childrenOf(req.user);
    const courses = await coursesOfClasses(children.map((c) => c.class_id).filter(Boolean));
    if (!courses.length) return NONE;
    return { is_published: 1, course_id: { $in: courses } };
  }

  return NONE;
}

const materialsRouter = createResourceRouter({
  table: 'course_materials',
  module: 'materials',
  entityType: 'Course Material',
  populate: {
    course_id: { name: 'course_name', code: 'course_code' },
    'course_id.subject_id': { name: 'subject_name' },
    'course_id.class_id': { name: 'class_name' },
    section_id: { name: 'section_name' },
    'faculty_id.user_id': { full_name: 'faculty_name' },
  },
  searchable: ['title', 'description'],
  filterable: ['course_id', 'section_id', 'material_type', 'faculty_id', 'is_published'],
  sortable: ['id', 'title', 'created_at', 'due_date'],
  defaultSort: 'created_at',
  scopeFilter: materialScope,
  /**
   * Material belongs to whoever uploaded it.
   *
   * Without this a teacher could pass a colleague's `faculty_id` and publish
   * under their name — and, because `canAccess` below keys on that same field,
   * be locked out of the file they had just created. The office may still
   * upload on a teacher's behalf, which is why the id is only forced for a
   * teacher rather than always taken from the caller.
   */
  beforeCreate: async (data, req) => {
    if (isTeacher(req.user)) {
      const mine = await facultyIdOf(req.user);
      if (data.faculty_id && Number(data.faculty_id) !== mine) {
        throw forbidden('You can only upload material under your own name.');
      }
      data.faculty_id = mine;
    }
    if (!data.faculty_id) throw badRequest('Choose the teacher this material belongs to');
    return data;
  },
  /** Nor may a teacher hand an existing upload to somebody else. */
  beforeUpdate: async (data, req) => {
    if (isTeacher(req.user) && data.faculty_id !== undefined) {
      if (Number(data.faculty_id) !== await facultyIdOf(req.user)) {
        throw forbidden('Material cannot be reassigned to another teacher.');
      }
    }
    return data;
  },
  // A teacher may only edit or delete their own uploads.
  canAccess: async (req, row) => {
    if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return true;
    if (isTeacher(req.user)) return row.faculty_id === await facultyIdOf(req.user);
    return true; // read access is already narrowed by materialScope
  },
});

/**
 * Download a material with its original filename.
 *
 * The file itself is stored under a generated name, so a plain link would save
 * as `1787…-9f2c.pdf`. This streams it back as an attachment named the way the
 * teacher uploaded it — and only to someone allowed to see the material, which
 * the scope clause below re-checks on the row itself.
 */
materialsRouter.get(
  '/:id/download',
  requirePermission('materials.view'),
  asyncHandler(async (req, res) => {
    const materialId = oid(req.params.id);
    const doc = materialId
      ? await CourseMaterial.findById(materialId).populate('course_id', 'class_id campus_id name')
      : null;
    if (!doc) throw notFound('Material not found');
    const material = { ...plain(doc), class_id: doc.course_id?.class_id ?? null };

    /*
     * Re-apply the visibility rule the listing uses.
     *
     * Asked as "does this record match both its own id and that rule?", which
     * is what the SQL did. Checking the rule separately would be a different
     * question, and a looser one.
     */
    const scope = await materialScope(req);
    if (scope) {
      const visible = await CourseMaterial.exists({ $and: [{ _id: materialId }, scope] });
      if (!visible) throw forbidden('This material is not shared with you');
    }

    if (!material.file_path) throw badRequest('This material is a link, not a file');

    const absolute = path.resolve(env.uploadDir, material.file_path.replace('/uploads/', ''));
    if (!absolute.startsWith(path.resolve(env.uploadDir)) || !fs.existsSync(absolute)) {
      throw notFound('The file is no longer available');
    }

    const filename = material.file_name || path.basename(absolute);
    await logActivity({
      req,
      action: 'DOWNLOAD',
      module: 'materials',
      entityType: 'Course Material',
      entityId: material.id,
      description: `Downloaded "${material.title}"`,
    });
    return res.download(absolute, filename);
  })
);

/** Upload a material file (or record a link). */
materialsRouter.post(
  '/upload',
  requirePermission('materials.create'),
  heavyLimiter,
  materialUpload.single('file'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      // An identifier is text now; the route checks it resolves.
      course_id: z.string().min(1),
      section_id: z.string().optional().nullable(),
      title: z.string().min(1, 'Enter a title').max(200),
      description: z.string().max(1000).optional().nullable(),
      material_type: z.enum(['NOTES', 'PDF', 'PRESENTATION', 'VIDEO', 'LINK', 'ASSIGNMENT', 'OTHER']).default('NOTES'),
      external_url: z.string().max(500).optional().nullable(),
      due_date: z.string().max(20).optional().nullable(),
      is_published: z.coerce.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    // Nothing has been stored yet — the file is still in memory — so a refused
    // request simply leaves nothing behind.
    if (!parsed.success) {
      throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    const body = parsed.data;

    const facultyId = await facultyIdOf(req.user);
    if (isTeacher(req.user)) {
      if (!await teacherOwnsCourse(req.user, body.course_id, body.section_id || null)) {
        throw forbidden('You may only upload material for courses assigned to you');
      }
    }
    if (!req.file && !body.external_url) throw badRequest('Attach a file or provide a link');

    const courseDoc = await Course.findById(oid(body.course_id));
    if (!courseDoc) throw notFound('Course not found');
    const course = plain(courseDoc);

    // Store the file, then record it. If recording fails — a missing faculty
    // member, a constraint — the stored file has nothing pointing at it and
    // would sit in the bucket for ever, so it is removed on the way out.
    const filePath = req.file ? await publicPath(req.file, 'materials') : null;
    let id;
    try {
      const saved = await CourseMaterial.create({
        campus_id: oid(course.campus_id),
        course_id: oid(body.course_id),
        section_id: oid(body.section_id) ?? null,
        faculty_id: oid(facultyId ?? req.body.faculty_id),
        title: body.title,
        description: body.description,
        material_type: body.material_type,
        file_path: filePath,
        file_name: req.file?.originalname ?? null,
        file_size: req.file?.size ?? null,
        external_url: body.external_url,
        due_date: body.due_date,
        is_published: body.is_published ? 1 : 0,
      });
      id = String(saved._id);
    } catch (error) {
      if (filePath) await deleteUpload(filePath).catch(() => {});
      throw error;
    }

    // Tell the class a new material is available.
    if (body.is_published) {
      const audience = { class_id: oid(course.class_id), user_id: { $ne: null }, status: 'ACTIVE' };
      // Material for one section is announced to that section only.
      if (body.section_id) audience.section_id = oid(body.section_id);
      const students = (await Student.find(audience).select('user_id').lean())
        .map((s) => String(s.user_id));
      await notifyMany(students, {
        campusId: course.campus_id,
        type: body.material_type === 'ASSIGNMENT' ? 'NEW_ASSIGNMENT' : 'NEW_MATERIAL',
        title: body.material_type === 'ASSIGNMENT' ? `New assignment: ${body.title}` : `New material: ${body.title}`,
        body: course.name,
        link: '/parent/materials',
        entityType: 'CourseMaterial',
        entityId: id,
      });
    }

    await logActivity({
      req,
      action: 'CREATE',
      module: 'materials',
      entityType: 'Course Material',
      entityId: id,
      description: `Uploaded "${body.title}" to ${course.name}`,
      newValues: { course_id: body.course_id, type: body.material_type },
    });

    return created(res, plain(await CourseMaterial.findById(oid(id))));
  })
);

/** Deleting a material also removes the stored file. */
materialsRouter.delete(
  '/:id/file',
  requirePermission('materials.delete'),
  asyncHandler(async (req, res) => {
    const id = oid(req.params.id);
    const doc = id ? await CourseMaterial.findById(id) : null;
    if (!doc) throw notFound('Material not found');
    const material = plain(doc);
    if (isTeacher(req.user) && !sameId(material.faculty_id, await facultyIdOf(req.user))) {
      throw forbidden('You may only remove your own material');
    }
    if (material.file_path) await deleteUpload(material.file_path);
    await CourseMaterial.updateOne({ _id: id }, { $set: { file_path: null, file_name: null, file_size: null } });
    return ok(res, { id, file_removed: true });
  })
);

export default materialsRouter;
