import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, insert, update } from '../db/connection.js';
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
async function materialScope(req) {
  if (isAdmin(req.user) || req.user.role_code === 'ADMINISTRATOR') return null;

  if (isTeacher(req.user)) {
    const facultyId = await facultyIdOf(req.user);
    return {
      clause: `(cm.faculty_id = ? OR cm.course_id IN (SELECT course_id FROM course_assignments WHERE faculty_id = ? AND status = 'ACTIVE'))`,
      params: [facultyId ?? 0, facultyId ?? 0],
    };
  }

  if (isStudent(req.user)) {
    const student = await get('SELECT class_id, section_id FROM students WHERE user_id = ?', [req.user.id]);
    if (!student) return { clause: '1 = 0', params: [] };
    return {
      clause: `cm.is_published = 1 AND co.class_id = ? AND (cm.section_id IS NULL OR cm.section_id = ?)`,
      params: [student.class_id, student.section_id],
    };
  }

  if (isParent(req.user)) {
    const children = await childrenOf(req.user);
    if (!children.length) return { clause: '1 = 0', params: [] };
    const classIds = children.map((c) => c.class_id).filter(Boolean);
    if (!classIds.length) return { clause: '1 = 0', params: [] };
    return {
      clause: `cm.is_published = 1 AND co.class_id IN (${classIds.map(() => '?').join(',')})`,
      params: classIds,
    };
  }

  return { clause: '1 = 0', params: [] };
}

const materialsRouter = createResourceRouter({
  table: 'course_materials',
  module: 'materials',
  entityType: 'Course Material',
  alias: 'cm',
  select: `cm.*, co.name AS course_name, co.code AS course_code, sub.name AS subject_name,
           u.full_name AS faculty_name, c.name AS class_name, sec.name AS section_name`,
  joins: `JOIN courses co ON co.id = cm.course_id
          JOIN subjects sub ON sub.id = co.subject_id
          JOIN faculty f ON f.id = cm.faculty_id
          JOIN users u ON u.id = f.user_id
          LEFT JOIN classes c ON c.id = co.class_id
          LEFT JOIN sections sec ON sec.id = cm.section_id`,
  searchable: ['cm.title', 'cm.description', 'co.name'],
  filterable: ['course_id', 'section_id', 'material_type', 'faculty_id', 'is_published'],
  sortable: ['id', 'title', 'created_at', 'due_date'],
  defaultSort: 'created_at',
  scopeClause: materialScope,
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
    const material = await get(
      `SELECT cm.*, co.class_id FROM course_materials cm
         JOIN courses co ON co.id = cm.course_id
        WHERE cm.id = ?`,
      [Number(req.params.id)]
    );
    if (!material) throw notFound('Material not found');

    // Re-apply the same visibility rule the listing uses.
    const scope = await materialScope(req);
    if (scope) {
      const visible = await get(
        `SELECT 1 AS ok FROM course_materials cm
           JOIN courses co ON co.id = cm.course_id
          WHERE cm.id = ? AND ${scope.clause}`,
        [material.id, ...scope.params]
      );
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
      course_id: z.coerce.number().int().positive(),
      section_id: z.coerce.number().int().positive().optional().nullable(),
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

    const course = await get('SELECT * FROM courses WHERE id = ?', [body.course_id]);
    if (!course) throw notFound('Course not found');

    // Store the file, then record it. If recording fails — a missing faculty
    // member, a constraint — the stored file has nothing pointing at it and
    // would sit in the bucket for ever, so it is removed on the way out.
    const filePath = req.file ? await publicPath(req.file, 'materials') : null;
    let id;
    try {
      id = await insert('course_materials', {
        campus_id: course.campus_id,
        course_id: body.course_id,
        section_id: body.section_id ?? null,
        faculty_id: facultyId ?? (Number(req.body.faculty_id) || null),
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
    } catch (error) {
      if (filePath) await deleteUpload(filePath).catch(() => {});
      throw error;
    }

    // Tell the class a new material is available.
    if (body.is_published) {
      const students = (await all(
        `SELECT user_id FROM students
          WHERE class_id = ? AND user_id IS NOT NULL AND status = 'ACTIVE'
            ${body.section_id ? 'AND section_id = ?' : ''}`,
        body.section_id ? [course.class_id, body.section_id] : [course.class_id]
      )).map((s) => s.user_id);
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

    return created(res, await get('SELECT * FROM course_materials WHERE id = ?', [id]));
  })
);

/** Deleting a material also removes the stored file. */
materialsRouter.delete(
  '/:id/file',
  requirePermission('materials.delete'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const material = await get('SELECT * FROM course_materials WHERE id = ?', [id]);
    if (!material) throw notFound('Material not found');
    if (isTeacher(req.user) && material.faculty_id !== await facultyIdOf(req.user)) {
      throw forbidden('You may only remove your own material');
    }
    if (material.file_path) await deleteUpload(material.file_path);
    await update('course_materials', id, { file_path: null, file_name: null, file_size: null });
    return ok(res, { id, file_removed: true });
  })
);

export default materialsRouter;
