import { Router } from 'express';
import { z } from 'zod';
import { ActivityLog, CourseAssignment, Document, Faculty, FacultyAttendance, LeaveRequest, Payroll, Role, SalaryStructure, Student, Timetable, User } from '../db/mongo/models.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { escapeRegex, insensitive, lift, plain, populateFor } from '../db/mongo/query.js';
import { asyncHandler, ok, created, pagination, paginated, safeSort } from '../lib/http.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { optionalNumber, validateBody } from '../middleware/validate.js';
import { photoUpload, documentUpload, publicPath } from '../middleware/upload.js';
import { heavyLimiter } from '../middleware/ratelimit.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity, diff } from '../lib/audit.js';
import { isAdmin, isStaff, facultyIdOf, sameId} from '../lib/scope.js';
import env from '../config/env.js';
import { facultyCodes } from '../lib/codes.js';

const router = Router();

const facultySchema = z.object({
  full_name: z.string().min(2).max(160),
  email: z.string().email('Enter a valid email address').max(160),
  username: z.string().min(3).max(60).optional(),
  password: z.string().min(8).max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  faculty_code: z.string().max(30).optional(),
  staff_type: z.enum(['TEACHING', 'FINANCIAL']),
  board: z.enum(['STATE', 'CBSE', 'BOTH']).optional(),
  department_id: z.coerce.number().int().positive().optional().nullable(),
  designation: z.string().max(80).optional().nullable(),
  qualification: z.string().max(160).optional().nullable(),
  specialization: z.string().max(160).optional().nullable(),
  experience_years: optionalNumber(0, 60),
  date_of_birth: z.string().max(20).optional().nullable(),
  date_of_joining: z.string().max(20).optional().nullable(),
  blood_group: z.string().max(6).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  emergency_contact: z.string().max(40).optional().nullable(),
  bank_account: z.string().max(40).optional().nullable(),
  pan_number: z.string().max(20).optional().nullable(),
  is_mentor: z.coerce.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED']).optional(),
});

/** What the joins lifted from the account, its role and the department. */
const JOINED = {
  user_id: {
    full_name: 'full_name', email: 'email', phone: 'phone', photo: 'photo',
    username: 'username', gender: 'gender', status: 'account_status',
  },
  'user_id.role_id': { code: 'role_code' },
  department_id: { name: 'department_name' },
};

/**
 * Courses assigned and mentees held, for these members of staff.
 *
 * Two correlated subqueries per row became two grouped queries per page.
 */
async function workloadFor(facultyIds) {
  const ids = facultyIds.map(oid).filter(Boolean);
  if (!ids.length) return new Map();
  const countBy = async (Model, field) => {
    const rows = await Model.aggregate([
      { $match: { [field]: { $in: ids }, status: 'ACTIVE' } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.n]));
  };
  const [courses, mentees] = await Promise.all([
    countBy(CourseAssignment, 'faculty_id'),
    countBy(Student, 'mentor_id'),
  ]);
  const out = new Map();
  for (const id of ids) {
    out.set(String(id), {
      assigned_courses: courses.get(String(id)) ?? 0,
      mentee_count: mentees.get(String(id)) ?? 0,
    });
  }
  return out;
}

/** One member of staff, in the shape the joins produced. */
async function loadFacultyRow(id) {
  const _id = oid(id);
  if (!_id) return null;
  const doc = await Faculty.findById(_id).populate(populateFor(JOINED));
  if (!doc) return null;
  const row = lift(doc, JOINED);
  Object.assign(row, (await workloadFor([row.id])).get(row.id) ?? {});
  return row;
}

const roleForStaffType = (staffType) => (staffType === 'TEACHING' ? 'TEACHING_STAFF' : 'FINANCIAL_STAFF');

/**
 * The next free faculty code.
 *
 * Counting the rows and adding one was the old way, and it repeats a code as
 * soon as anyone is removed: twenty-three staff less one leaves 22, and the
 * next code offered is VFT0023 — which still belongs to someone. The allocator
 * counts from the highest number actually in use.
 */
async function nextFacultyCode(campusId, staffType) {
  return (await facultyCodes(campusId, staffType)).take();
}

// ------------------------------------------------------------------ list
router.get(
  '/',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const { column, direction } = safeSort(req.query, ['id', 'faculty_code', 'date_of_joining', 'created_at'], 'id');

    const filter = {};
    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);
    for (const field of ['staff_type', 'department_id', 'status', 'is_mentor']) {
      const value = req.query[field];
      if (value !== undefined && value !== '' && value !== 'ALL') {
        filter[field] = field.endsWith('_id') ? oid(value) : value;
      }
    }

    // Asking for one wing also returns the staff who serve both; asking for
    // BOTH means only those.
    if (req.query.board && req.query.board !== 'ALL') {
      filter.board = req.query.board === 'BOTH' ? 'BOTH' : { $in: [req.query.board, 'BOTH'] };
    }

    // The name and email live on the account, which the join reached.
    if (req.query.search) {
      const term = new RegExp(escapeRegex(String(req.query.search)), 'i');
      const accounts = await User.find({ $or: [{ full_name: term }, { email: term }] })
        .select('_id').lean();
      filter.$or = [
        { faculty_code: term },
        { designation: term },
        { user_id: { $in: accounts.map((u) => u._id) } },
      ];
    }

    const sortField = column === 'id' ? '_id' : column;
    const [docs, total] = await Promise.all([
      Faculty.find(filter)
        .populate(populateFor(JOINED))
        .sort({ [sortField]: direction === 'ASC' ? 1 : -1, _id: 1 })
        .skip(offset)
        .limit(limit),
      Faculty.countDocuments(filter),
    ]);

    const rows = lift(docs, JOINED);
    const workload = await workloadFor(rows.map((r) => r.id));
    for (const row of rows) Object.assign(row, workload.get(row.id) ?? {});
    return paginated(res, rows, total, { page, limit });
  })
);

// ---------------------------------------------------------------- detail
router.get(
  '/:id',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const row = await loadFacultyRow(req.params.id);
    if (!row) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && !sameId(row.campus_id, req.user.campus_id)) throw forbidden('Different campus');
    return ok(res, row);
  })
);

/** Full faculty profile: assignments, attendance, leave, documents, salary. */
router.get(
  '/:id/profile',
  requirePermission('faculty.view'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const faculty = await loadFacultyRow(id);
    if (!faculty) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && !sameId(faculty.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const assignmentDocs = await CourseAssignment.find({ faculty_id: oid(id) })
      .select('course_id section_id status')
      .populate({ path: 'course_id', select: 'code name subject_id', populate: { path: 'subject_id', select: 'name' } })
      .populate({ path: 'section_id', select: 'name class_id', populate: { path: 'class_id', select: 'name' } });

    const assignments = assignmentDocs
      .map((a) => ({
        id: String(a._id),
        course_code: a.course_id?.code ?? null,
        course_name: a.course_id?.name ?? null,
        subject_name: a.course_id?.subject_id?.name ?? null,
        class_name: a.section_id?.class_id?.name ?? null,
        section_name: a.section_id?.name ?? null,
        status: a.status,
      }))
      .sort((a, b) => String(a.class_name ?? '').localeCompare(String(b.class_name ?? ''))
        || String(a.section_name ?? '').localeCompare(String(b.section_name ?? '')));

    const [attendanceRow] = await FacultyAttendance.aggregate([
      { $match: { faculty_id: oid(id) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
          leave_count: { $sum: { $cond: [{ $eq: ['$status', 'LEAVE'] }, 1, 0] } },
        },
      },
    ]);
    const attendance = attendanceRow || { total: 0, present: 0, absent: 0, leave_count: 0 };

    const leaves = plain(
      await LeaveRequest.find({ requester_type: 'FACULTY', faculty_id: oid(id) })
        .sort({ created_at: -1 }).limit(20)
    );

    // `owner_id` is text, because a document may belong to any kind of record.
    const documents = plain(
      await Document.find({ owner_type: 'FACULTY', owner_id: String(id) }).sort({ created_at: -1 })
    );

    const mentees = lift(
      await Student.find({ mentor_id: oid(id), status: 'ACTIVE' })
        .select('admission_number first_name last_name class_id section_id')
        .populate('class_id', 'name')
        .populate('section_id', 'name'),
      { class_id: { name: 'class_name' }, section_id: { name: 'section_name' } }
    );

    const timetable = lift(
      await Timetable.find({ faculty_id: oid(id) })
        .populate('course_id', 'name')
        .populate('section_id', 'name')
        .populate('class_id', 'name')
        .sort({ day_of_week: 1, period: 1 }),
      {
        course_id: { name: 'course_name' },
        section_id: { name: 'section_name' },
        class_id: { name: 'class_name' },
      }
    );

    // Salary is visible to Admin, payroll-permitted staff, or the person themselves.
    const isSelf = sameId(await facultyIdOf(req.user), id);
    const canSeeSalary = isAdmin(req.user) || req.permissions.has('payroll.view') || isSelf;
    const salary = canSeeSalary
      ? {
          structure: plain(
            await SalaryStructure.findOne({ user_id: oid(faculty.user_id), status: 'ACTIVE' })
              .sort({ effective_from: -1 })
          ),
          recent: plain(
            await Payroll.find({ user_id: oid(faculty.user_id) })
              .sort({ year: -1, month: -1 }).limit(12)
          ),
        }
      : null;

    const activity = isStaff(req.user)
      ? plain(
        await ActivityLog.find({ entity_type: 'Faculty', entity_id: String(id) })
          .select('action module description user_name created_at')
          .sort({ created_at: -1 }).limit(20)
      )
      : [];

    return ok(res, { faculty, assignments, attendance, leaves, documents, mentees, timetable, salary, activity });
  })
);

// --------------------------------------------------------------- create
router.post(
  '/',
  requirePermission('faculty.create'),
  validateBody(facultySchema),
  asyncHandler(async (req, res) => {
    const body = req.body;
    const campusId = isAdmin(req.user) && req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    const roleCode = roleForStaffType(body.staff_type);
    const role = await Role.findOne({ code: roleCode }).select('_id').lean();
    if (!role) throw badRequest('Role configuration missing');

    const facultyCode = body.faculty_code || await nextFacultyCode(campusId, body.staff_type);
    const username = body.username || facultyCode.toLowerCase();

    if (await User.exists({ username: insensitive(username) })) throw conflict('That username is taken');
    if (await User.exists({ email: insensitive(body.email) })) throw conflict('That email is registered');
    if (await Faculty.exists({ faculty_code: facultyCode })) throw conflict('That faculty code exists');

    const password = body.password || env.seedPassword;
    const passwordHash = await hashPassword(password);

    const result = await transaction(async (session) => {
      const opts = session ? { session } : {};
      const [account] = await User.create([{
        username,
        email: body.email,
        password_hash: passwordHash,
        full_name: body.full_name,
        phone: body.phone,
        gender: body.gender,
        role_id: role?._id,
        campus_id: oid(campusId),
        status: 'ACTIVE',
        must_change_password: body.password ? 0 : 1,
        created_by: oid(req.user.id),
      }], opts);
      const userId = account._id;

      const [member] = await Faculty.create([{
        user_id: userId,
        campus_id: oid(campusId),
        faculty_code: facultyCode,
        staff_type: body.staff_type,
        board: body.board || 'BOTH',
        department_id: oid(body.department_id),
        designation: body.designation,
        qualification: body.qualification,
        specialization: body.specialization,
        experience_years: body.experience_years ?? 0,
        date_of_birth: body.date_of_birth,
        date_of_joining: body.date_of_joining || new Date().toISOString().slice(0, 10),
        blood_group: body.blood_group,
        address: body.address,
        emergency_contact: body.emergency_contact,
        bank_account: body.bank_account,
        pan_number: body.pan_number,
        is_mentor: body.is_mentor ? 1 : 0,
        status: body.status || 'ACTIVE',
      }], opts);

      return { userId: String(userId), facultyId: String(member._id) };
    });

    await logActivity({
      req,
      action: 'CREATE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: result.facultyId,
      description: `Created ${body.staff_type} staff ${body.full_name} (${facultyCode})`,
      newValues: { faculty_code: facultyCode, staff_type: body.staff_type, role: roleCode },
    });

    const row = await loadFacultyRow(result.facultyId);
    return created(res, { ...row, temporaryPassword: body.password ? undefined : password });
  })
);

// --------------------------------------------------------------- update
router.put(
  '/:id',
  requirePermission('faculty.edit'),
  validateBody(facultySchema.partial()),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = plain(await Faculty.findById(oid(id)));
    if (!existing) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && !sameId(existing.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    const facultyFields = [
      'board', 'department_id', 'designation', 'qualification', 'specialization', 'experience_years',
      'date_of_birth', 'date_of_joining', 'blood_group', 'address', 'emergency_contact',
      'bank_account', 'pan_number', 'status',
    ];
    const data = {};
    for (const f of facultyFields) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (req.body.is_mentor !== undefined) data.is_mentor = req.body.is_mentor ? 1 : 0;

    // Changing category also changes the login role — they must stay in step.
    if (req.body.staff_type && req.body.staff_type !== existing.staff_type) {
      const role = await Role.findOne({ code: roleForStaffType(req.body.staff_type) }).select('_id').lean();
      data.staff_type = req.body.staff_type;
      // The login role follows the category — they must stay in step, or a
      // teacher moved to finance keeps a teacher's permissions.
      await User.updateOne({ _id: oid(existing.user_id) }, { $set: { role_id: role?._id } });
      await logActivity({
        req,
        action: 'ROLE_CHANGE',
        module: 'faculty',
        entityType: 'Faculty',
        entityId: id,
        description: `Moved ${existing.faculty_code} from ${existing.staff_type} to ${req.body.staff_type}`,
        oldValues: { staff_type: existing.staff_type },
        newValues: { staff_type: req.body.staff_type },
      });
    }

    if (Object.keys(data).length) {
      await Faculty.updateOne({ _id: oid(id) }, { $set: data }, { runValidators: true });
    }

    const userData = {};
    for (const f of ['full_name', 'email', 'phone', 'gender']) if (req.body[f] !== undefined) userData[f] = req.body[f];
    if (Object.keys(userData).length) {
      await User.updateOne({ _id: oid(existing.user_id) }, { $set: userData });
    }

    const changes = diff(existing, { ...existing, ...data });
    await logActivity({
      req,
      action: 'UPDATE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: id,
      description: `Updated faculty ${existing.faculty_code}`,
      oldValues: changes.old,
      newValues: { ...changes.new, ...userData },
    });

    return ok(res, await loadFacultyRow(id));
  })
);

router.post(
  '/:id/photo',
  requirePermission('faculty.edit'),
  heavyLimiter,
  photoUpload.single('photo'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const faculty = plain(await Faculty.findById(oid(id)));
    if (!faculty) throw notFound('Faculty member not found');
    if (!req.file) throw badRequest('No photo was uploaded');
    const path = await publicPath(req.file, 'photos');
    await User.updateOne({ _id: oid(faculty.user_id) }, { $set: { photo: path } });
    await logActivity({ req, action: 'UPDATE', module: 'faculty', entityType: 'Faculty', entityId: id, description: 'Updated photo' });
    return ok(res, { id, photo: path });
  })
);

router.post(
  '/:id/documents',
  requirePermission('documents.create', 'faculty.edit'),
  heavyLimiter,
  documentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const faculty = plain(await Faculty.findById(oid(id)));
    if (!faculty) throw notFound('Faculty member not found');
    if (!req.file) throw badRequest('No file was uploaded');

    const docId = String((await Document.create({
      campus_id: oid(faculty.campus_id),
      owner_type: 'FACULTY',
      // Text: a document may belong to a record in any collection.
      owner_id: String(id),
      title: req.body.title || req.file.originalname,
      document_type: req.body.document_type || 'GENERAL',
      file_path: await publicPath(req.file, 'documents'),
      file_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_by: oid(req.user.id),
    }))._id);
    return created(res, plain(await Document.findById(oid(docId))));
  })
);

router.delete(
  '/:id',
  requirePermission('faculty.delete'),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const faculty = plain(await Faculty.findById(oid(id)));
    if (!faculty) throw notFound('Faculty member not found');
    if (!isAdmin(req.user) && !sameId(faculty.campus_id, req.user.campus_id)) throw forbidden('Different campus');

    // What the foreign key refused: removing someone who is still teaching.
    const assigned = await CourseAssignment.countDocuments({ faculty_id: oid(id), status: 'ACTIVE' });
    if (assigned) throw badRequest(`Reassign ${assigned} active course assignment(s) before deleting this member`);

    // The record and the account go together, or a sign-in survives the person.
    await transaction(async (session) => {
      const opts = session ? { session } : {};
      await Faculty.deleteOne({ _id: oid(id) }, opts);
      if (faculty.user_id) await User.deleteOne({ _id: oid(faculty.user_id) }, opts);
    });
    await logActivity({
      req,
      action: 'DELETE',
      module: 'faculty',
      entityType: 'Faculty',
      entityId: id,
      description: `Deleted faculty ${faculty.faculty_code}`,
      oldValues: faculty,
    });
    return ok(res, { id, deleted: true });
  })
);

export default router;
