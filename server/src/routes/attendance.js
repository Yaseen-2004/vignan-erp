import { Router } from 'express';
import { z } from 'zod';
import { Attendance, Class, Course, CourseAssignment, Faculty, FacultyAttendance, LeaveRequest, Parent, Section, Student, StudentParent } from '../db/mongo/models.js';
import { sameId } from '../lib/scope.js';
import { oid, transaction } from '../db/mongo/connection.js';
import { lift, plain, populateFor } from '../db/mongo/query.js';
import { asyncHandler, ok, created, pagination, paginated } from '../lib/http.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createResourceRouter } from '../lib/crud.js';
import { logActivity } from '../lib/audit.js';
import {
  isAdmin, isTeacher, isStudent, isParent, facultyIdOf, studentIdOf,
  accessibleStudentIds, assertStudentAccess, teacherOwnsCourse, childrenOf,
} from '../lib/scope.js';
import { notify } from '../lib/notify.js';

const router = Router();

// Student attendance is a binary record: a student is either present or absent.
const STATUSES = ['PRESENT', 'ABSENT'];

// ------------------------------------------------- student attendance list
router.get(
  '/students',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query, 50);
    const filter = {};

    if (!isAdmin(req.user) && req.user.campus_id) filter.campus_id = oid(req.user.campus_id);

    const allowed = await accessibleStudentIds(req.user);
    if (allowed !== null) {
      if (!allowed.length) return paginated(res, [], 0, { page, limit });
      filter.student_id = { $in: allowed.map(oid).filter(Boolean) };
    }
    for (const field of ['student_id', 'course_id', 'section_id', 'status', 'academic_year_id']) {
      if (req.query[field] && req.query[field] !== 'ALL') {
        filter[field] = field.endsWith('_id') ? oid(req.query[field]) : req.query[field];
      }
    }
    if (req.query.date) filter.attendance_date = req.query.date;
    if (req.query.from || req.query.to) {
      const range = {};
      if (req.query.from) range.$gte = String(req.query.from);
      if (req.query.to) range.$lte = `${String(req.query.to)}\uffff`;
      filter.attendance_date = range;
    }

    const MAPPING = {
      student_id: {
        first_name: 'first_name', last_name: 'last_name',
        admission_number: 'admission_number', roll_number: 'roll_number',
      },
      'student_id.class_id': { name: 'class_name' },
      course_id: { name: 'course_name' },
      section_id: { name: 'section_name' },
      marked_by: { full_name: 'marked_by_name' },
    };

    const [docs, total] = await Promise.all([
      Attendance.find(filter)
        .populate(populateFor(MAPPING))
        .sort({ attendance_date: -1 })
        .skip(offset)
        .limit(limit),
      Attendance.countDocuments(filter),
    ]);

    // The roll breaks ties within a date, and is compared as a number so that
    // 10 follows 9 rather than 1.
    const rows = lift(docs, MAPPING)
      .sort((a, b) => String(b.attendance_date ?? '').localeCompare(String(a.attendance_date ?? ''))
        || (Number(a.roll_number) || Infinity) - (Number(b.roll_number) || Infinity));
    return paginated(res, rows, total, { page, limit });
  })
);

/**
 * The register a teacher opens to mark a class: every active student in the
 * section with any attendance already recorded for that date/period.
 */
router.get(
  '/register',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const sectionId = req.query.section_id;
    const courseId = req.query.course_id ? Number(req.query.course_id) : null;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = Number(req.query.period || 0);
    if (!sectionId) throw badRequest('section_id is required');

    // Assignment check — a teacher may only open their own register.
    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await CourseAssignment.exists({
        faculty_id: oid(facultyId),
        section_id: oid(sectionId),
        status: 'ACTIVE',
        ...(courseId ? { course_id: oid(courseId) } : {}),
      });
      if (!assigned) throw forbidden('This class is not assigned to you');
    }

    /*
     * Every pupil in the section, with whatever has already been marked for
     * this date and period beside them. The LEFT JOIN is what made it "every
     * pupil" rather than "every pupil already marked" — a register that only
     * listed the ones already recorded would be useless for taking it.
     */
    const pupils = plain(
      await Student.find({ section_id: oid(sectionId), status: 'ACTIVE' })
        .select('admission_number roll_number first_name last_name photo')
    );

    const marks = await Attendance.find({
      student_id: { $in: pupils.map((x) => oid(x.id)) },
      attendance_date: date,
      period,
      // A register for a particular lesson, or the day's own register.
      course_id: courseId ? oid(courseId) : null,
    }).select('student_id status remarks').lean();
    const markFor = new Map(marks.map((m) => [String(m.student_id), m]));

    const students = pupils
      .map((pupil) => ({
        ...pupil,
        attendance_id: markFor.has(pupil.id) ? String(markFor.get(pupil.id)._id) : null,
        status: markFor.get(pupil.id)?.status ?? null,
        remarks: markFor.get(pupil.id)?.remarks ?? null,
      }))
      // By roll as a number, then by name — a roll that is not a number sorts
      // last, as the CASE made NULL do.
      .sort((a, b) => (Number(a.roll_number) || Infinity) - (Number(b.roll_number) || Infinity)
        || String(a.first_name ?? '').localeCompare(String(b.first_name ?? '')));

    const sectionDoc = await Section.findById(oid(sectionId)).populate('class_id', 'name');
    const section = sectionDoc ? lift(sectionDoc, { class_id: { name: 'class_name' } }) : null;
    return ok(res, { date, period, course_id: courseId, section, students, marked: students.some((s) => s.attendance_id) });
  })
);

/**
 * The most recent earlier period marked for this section today.
 *
 * Attendance rarely changes between consecutive hours, so a teacher can pull
 * the previous hour forward and only correct the students who moved. Nothing
 * is written here — the register is filled in the browser and still goes
 * through the normal marking endpoint, which re-checks the assignment.
 */
router.get(
  '/previous',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const sectionId = req.query.section_id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = Number(req.query.period || 0);
    if (!sectionId) throw badRequest('section_id is required');

    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await CourseAssignment.exists({
        faculty_id: oid(facultyId),
        section_id: oid(sectionId),
        status: 'ACTIVE',
      });
      if (!assigned) throw forbidden('This class is not assigned to you');
    }

    // The nearest earlier period that actually has records.
    const [source] = await Attendance.aggregate([
      { $match: { section_id: oid(sectionId), attendance_date: date, period: { $lt: period } } },
      { $group: { _id: { period: '$period', course_id: '$course_id' }, marked: { $sum: 1 } } },
      { $sort: { '_id.period': -1 } },
      { $limit: 1 },
    ]).then((rows) => rows.map((r) => ({ period: r._id.period, course_id: r._id.course_id, marked: r.marked })));

    if (!source) {
      return ok(res, { found: false, period: null, records: [] });
    }

    const records = (await Attendance.find({
      section_id: oid(sectionId),
      attendance_date: date,
      period: source.period,
      course_id: source.course_id ?? null,
    }).select('student_id status remarks').lean())
      .map((r) => ({ student_id: String(r.student_id), status: r.status, remarks: r.remarks }));

    const course = source.course_id
      ? await Course.findById(source.course_id).select('name').lean()
      : null;

    return ok(res, {
      found: true,
      period: source.period,
      course_name: course?.name ?? null,
      marked: records.length,
      records,
    });
  })
);

/** Bulk mark / update attendance for a class. */
router.post(
  '/mark',
  requirePermission('attendance.create'),
  validateBody(
    z.object({
      section_id: z.coerce.number().int().positive(),
      course_id: z.coerce.number().int().positive().optional().nullable(),
      academic_year_id: z.coerce.number().int().positive().optional().nullable(),
      attendance_date: z.string().min(8).max(20),
      period: z.coerce.number().int().min(0).max(12).default(0),
      records: z
        .array(
          z.object({
            student_id: z.coerce.number().int().positive(),
            status: z.enum(STATUSES),
            remarks: z.string().max(200).optional().nullable(),
          })
        )
        .min(1, 'No attendance records supplied'),
    })
  ),
  asyncHandler(async (req, res) => {
    const { section_id, course_id, attendance_date, period, records, academic_year_id } = req.body;

    if (new Date(attendance_date) > new Date(new Date().toISOString().slice(0, 10))) {
      throw badRequest('Attendance cannot be marked for a future date');
    }

    if (isTeacher(req.user)) {
      const facultyId = await facultyIdOf(req.user);
      const assigned = await CourseAssignment.exists({
        faculty_id: oid(facultyId),
        section_id: oid(section_id),
        status: 'ACTIVE',
        ...(course_id ? { course_id: oid(course_id) } : {}),
      });
      if (!assigned) throw forbidden('You may only mark attendance for classes assigned to you');
    }

    const sectionStudents = new Set(
      (await Student.find({ section_id: oid(section_id), status: 'ACTIVE' }).select('_id').lean())
        .map((r) => String(r._id))
    );
    const campusId = req.user.campus_id;

    /*
     * The whole register is one unit. Half a class marked is worse than none:
     * the teacher believes it is done, and the pupils in the unwritten half
     * show as never having been recorded.
     */
    const summary = await transaction(async (session) => {
      const opts = session ? { session } : {};
      let inserted = 0;
      let updated = 0;
      const absentees = [];

      for (const record of records) {
        // Silently skip a pupil who is not in this section.
        if (!sectionStudents.has(String(record.student_id))) continue;

        /*
         * Written as one upsert rather than a read then a write. Two teachers
         * marking the same lesson would both find nothing and both insert,
         * leaving the same pupil recorded twice for one period — the unique
         * key refused that, and matching on the same four fields does too.
         */
        const key = {
          student_id: oid(record.student_id),
          attendance_date,
          period,
          course_id: course_id ? oid(course_id) : null,
        };
        const result = await Attendance.updateOne(
          key,
          {
            $set: {
              status: record.status,
              remarks: record.remarks ?? null,
              marked_by: oid(req.user.id),
            },
            $setOnInsert: {
              campus_id: oid(campusId),
              section_id: oid(section_id),
              academic_year_id: oid(academic_year_id),
            },
          },
          { ...opts, upsert: true }
        );

        if (result.upsertedCount) inserted += 1;
        else updated += 1;
        if (record.status === 'ABSENT') absentees.push(record.student_id);
      }
      return { inserted, updated, absentees };
    });

    // Tell the parents of absent children.
    // Resolved for the whole class at once rather than per absent child.
    const absentIds = summary.absentees.map(oid).filter(Boolean);
    const absentPupils = absentIds.length
      ? await Student.find({ _id: { $in: absentIds } }).select('first_name last_name').lean()
      : [];
    const pupilFor = new Map(absentPupils.map((x) => [String(x._id), x]));

    const links = absentIds.length
      ? await StudentParent.find({ student_id: { $in: absentIds } }).select('student_id parent_id').lean()
      : [];
    const families = links.length
      ? await Parent.find({ _id: { $in: links.map((l) => l.parent_id) }, user_id: { $ne: null } })
        .select('user_id').lean()
      : [];
    const accountFor = new Map(families.map((f) => [String(f._id), f.user_id]));

    const parentsOf = new Map();
    for (const link of links) {
      const account = accountFor.get(String(link.parent_id));
      if (!account) continue;
      const key = String(link.student_id);
      if (!parentsOf.has(key)) parentsOf.set(key, []);
      parentsOf.get(key).push(account);
    }

    for (const studentId of summary.absentees) {
      const student = pupilFor.get(String(studentId));
      if (!student) continue;
      for (const account of parentsOf.get(String(studentId)) ?? []) {
        await notify({
          userId: String(account),
          campusId,
          type: 'ATTENDANCE',
          title: 'Absence recorded',
          body: `${student.first_name} ${student.last_name || ''} was marked absent on ${attendance_date}.`,
          link: '/parent/attendance',
          entityType: 'Student',
          entityId: studentId,
        });
      }
    }

    await logActivity({
      req,
      action: 'ATTENDANCE_UPDATE',
      module: 'attendance',
      entityType: 'Attendance',
      entityId: section_id,
      description: `Marked attendance for section #${section_id} on ${attendance_date} (period ${period}): ${summary.inserted} new, ${summary.updated} updated`,
      newValues: { section_id, course_id, attendance_date, period, count: records.length },
    });

    return created(res, summary);
  })
);

/** Per-student attendance summary: overall, monthly and per subject. */
router.get(
  '/summary/:studentId',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const studentId = req.params.studentId;
    await assertStudentAccess(req.user, studentId);

    const mine = { student_id: oid(studentId) };
    const presence = {
      total: { $sum: 1 },
      present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
    };

    const [overallRow] = await Attendance.aggregate([
      { $match: mine },
      { $group: { _id: null, ...presence, absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } } } },
    ]);
    const overall = overallRow || { total: 0, present: 0, absent: 0 };

    // By month: the first seven characters of the date, as substr() took.
    const monthly = (await Attendance.aggregate([
      { $match: mine },
      { $group: { _id: { $substrBytes: ['$attendance_date', 0, 7] }, ...presence } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ])).map((m) => ({ month: m._id, total: m.total, present: m.present }));

    // By subject — only lessons, since a day's register carries no course.
    const byCourse = await Attendance.aggregate([
      { $match: { ...mine, course_id: { $ne: null } } },
      { $group: { _id: '$course_id', ...presence } },
    ]);
    const courses = byCourse.length
      ? await Course.find({ _id: { $in: byCourse.map((c) => c._id) } })
        .select('name subject_id').populate('subject_id', 'name')
      : [];
    const courseFor = new Map(courses.map((c) => [String(c._id), c]));
    const bySubject = byCourse
      .map((c) => ({
        course_id: String(c._id),
        course_name: courseFor.get(String(c._id))?.name ?? null,
        subject_name: courseFor.get(String(c._id))?.subject_id?.name ?? null,
        total: c.total,
        present: c.present,
      }))
      .sort((a, b) => String(a.subject_name ?? '').localeCompare(String(b.subject_name ?? '')));

    const recent = lift(
      await Attendance.find(mine)
        .select('attendance_date status period remarks course_id')
        .populate('course_id', 'name')
        .sort({ attendance_date: -1 })
        .limit(30),
      { course_id: { name: 'course_name' } }
    );

    const pct = (present, total) => (total ? Number(((present / total) * 100).toFixed(2)) : 0);
    return ok(res, {
      overall: { ...overall, percentage: pct(overall.present, overall.total) },
      monthly: monthly.map((m) => ({ ...m, percentage: pct(m.present, m.total) })),
      bySubject: bySubject.map((s) => ({ ...s, percentage: pct(s.present, s.total) })),
      recent,
    });
  })
);

/** Daily overview for administrators. */
router.get(
  '/overview',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const campusId = req.user.campus_id;
    const scope = isAdmin(req.user) && !campusId ? {} : { campus_id: oid(campusId) };
    const today = { ...scope, attendance_date: date };
    const presence = {
      total: { $sum: 1 },
      present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
    };

    /*
     * COUNT(DISTINCT student_id): a pupil marked in five lessons is one pupil
     * marked, not five. Counting the records would report a class of thirty as
     * a hundred and fifty.
     */
    const [totalsRow] = await Attendance.aggregate([
      { $match: today },
      {
        $group: {
          _id: null,
          pupils: { $addToSet: '$student_id' },
          present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        },
      },
    ]);
    const totals = {
      marked: totalsRow?.pupils?.length ?? 0,
      present: totalsRow?.present ?? 0,
      absent: totalsRow?.absent ?? 0,
    };

    // Grouped by the pupil's class and section, which belong to the pupil
    // rather than to the record — which is why the pupil is joined in.
    const grouped = await Attendance.aggregate([
      { $match: today },
      { $lookup: { from: 'students', localField: 'student_id', foreignField: '_id', as: 'pupil' } },
      { $unwind: '$pupil' },
      { $group: { _id: { class_id: '$pupil.class_id', section_id: '$pupil.section_id' }, ...presence } },
    ]);

    const classes = await Class.find({ _id: { $in: grouped.map((g) => g._id.class_id).filter(Boolean) } })
      .select('name numeric_level').lean();
    const classFor = new Map(classes.map((c) => [String(c._id), c]));
    const sections = await Section.find({ _id: { $in: grouped.map((g) => g._id.section_id).filter(Boolean) } })
      .select('name').lean();
    const sectionFor = new Map(sections.map((x) => [String(x._id), x.name]));

    const byClass = grouped
      .map((g) => ({
        id: String(g._id.class_id),
        class_name: classFor.get(String(g._id.class_id))?.name ?? null,
        section_name: sectionFor.get(String(g._id.section_id)) ?? null,
        total: g.total,
        present: g.present,
        _level: classFor.get(String(g._id.class_id))?.numeric_level ?? 0,
      }))
      .sort((a, b) => a._level - b._level
        || String(a.section_name ?? '').localeCompare(String(b.section_name ?? '')))
      .map(({ _level, ...row }) => row);

    // The fortnight up to the chosen day.
    const since = new Date(new Date(date).getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const trend = (await Attendance.aggregate([
      { $match: { ...scope, attendance_date: { $gte: since } } },
      { $group: { _id: '$attendance_date', ...presence } },
      { $sort: { _id: 1 } },
    ])).map((t) => ({ date: t._id, total: t.total, present: t.present }));

    return ok(res, {
      date,
      totals,
      byClass: byClass.map((r) => ({ ...r, percentage: r.total ? Number(((r.present / r.total) * 100).toFixed(1)) : 0 })),
      trend: trend.map((r) => ({ ...r, percentage: r.total ? Number(((r.present / r.total) * 100).toFixed(1)) : 0 })),
    });
  })
);

// ------------------------------------------------- faculty attendance
const facultyAttendanceRouter = createResourceRouter({
  table: 'faculty_attendance',
  module: 'faculty_attendance',
  entityType: 'Faculty Attendance',
  populate: {
    faculty_id: { faculty_code: 'faculty_code', staff_type: 'staff_type' },
    'faculty_id.user_id': { full_name: 'faculty_name' },
    'faculty_id.department_id': { name: 'department_name' },
  },
  searchable: [],
  filterable: ['faculty_id', 'status', 'attendance_date'],
  sortable: ['id', 'attendance_date'],
  required: ['faculty_id', 'attendance_date', 'status'],
  defaultSort: 'attendance_date',
  beforeCreate: (data, req) => ({ ...data, marked_by: req.user.id }),
  // Faculty may only read their own attendance unless they can manage it.
  scopeFilter: async (req) => {
    if (req.permissions.has('faculty_attendance.edit') || isAdmin(req.user)) return null;
    const facultyId = await facultyIdOf(req.user);
    // Somebody with no faculty record of their own sees none, not all.
    return facultyId ? { faculty_id: oid(facultyId) } : { $expr: { $eq: [1, 0] } };
  },
});

/** Bulk mark staff attendance for a day. */
facultyAttendanceRouter.post(
  '/bulk',
  requirePermission('faculty_attendance.create'),
  validateBody(
    z.object({
      attendance_date: z.string().min(8).max(20),
      records: z
        .array(
          z.object({
            faculty_id: z.coerce.number().int().positive(),
            status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY']),
            check_in: z.string().max(10).optional().nullable(),
            check_out: z.string().max(10).optional().nullable(),
            remarks: z.string().max(200).optional().nullable(),
          })
        )
        .min(1),
    })
  ),
  asyncHandler(async (req, res) => {
    const { attendance_date, records } = req.body;
    const campusId = req.user.campus_id;

    // Everyone named, fetched once rather than one at a time inside the loop.
    const staff = await Faculty.find({ _id: { $in: records.map((r) => oid(r.faculty_id)).filter(Boolean) } })
      .select('campus_id').lean();
    const staffFor = new Map(staff.map((f) => [String(f._id), f]));

    const summary = await transaction(async (session) => {
      const opts = session ? { session } : {};
      let inserted = 0;
      let updated = 0;

      for (const record of records) {
        const faculty = staffFor.get(String(record.faculty_id));
        if (!faculty) continue;
        if (!isAdmin(req.user) && !sameId(faculty.campus_id, campusId)) continue;

        // One upsert on the pair that must be unique — a person and a day —
        // rather than a read followed by a write that could race with itself.
        const result = await FacultyAttendance.updateOne(
          { faculty_id: oid(record.faculty_id), attendance_date },
          {
            $set: {
              status: record.status,
              check_in: record.check_in,
              check_out: record.check_out,
              remarks: record.remarks,
              marked_by: oid(req.user.id),
            },
            $setOnInsert: { campus_id: faculty.campus_id },
          },
          { ...opts, upsert: true }
        );

        if (result.upsertedCount) inserted += 1;
        else updated += 1;
      }
      return { inserted, updated };
    });

    await logActivity({
      req,
      action: 'ATTENDANCE_UPDATE',
      module: 'faculty_attendance',
      entityType: 'Faculty Attendance',
      description: `Marked staff attendance for ${attendance_date}: ${summary.inserted} new, ${summary.updated} updated`,
    });
    return created(res, summary);
  })
);
router.use('/faculty', facultyAttendanceRouter);

// ------------------------------------------------------- leave requests
const leaveRouter = createResourceRouter({
  table: 'leave_requests',
  module: 'leave',
  entityType: 'Leave Request',
  alias: 'lr',
  select: `lr.*,
           s.first_name AS student_first_name, s.last_name AS student_last_name, s.admission_number,
           fu.full_name AS faculty_name, f.faculty_code,
           ru.full_name AS reviewed_by_name, c.name AS class_name, sec.name AS section_name`,
  joins: `LEFT JOIN students s ON s.id = lr.student_id
          LEFT JOIN classes c ON c.id = s.class_id
          LEFT JOIN sections sec ON sec.id = s.section_id
          LEFT JOIN faculty f ON f.id = lr.faculty_id
          LEFT JOIN users fu ON fu.id = f.user_id
          LEFT JOIN users ru ON ru.id = lr.reviewed_by`,
  searchable: ['lr.reason', 's.first_name', 'fu.full_name'],
  filterable: ['status', 'requester_type', 'student_id', 'faculty_id', 'leave_type'],
  sortable: ['id', 'from_date', 'created_at'],
  required: ['requester_type', 'from_date', 'to_date', 'reason'],
  defaultSort: 'created_at',
  beforeCreate: async (data, req) => {
    data.raised_by = req.user.id;
    data.status = 'PENDING';

    // Students and parents may only raise leave for themselves / their child.
    if (isStudent(req.user)) {
      data.requester_type = 'STUDENT';
      data.student_id = await studentIdOf(req.user);
    } else if (isParent(req.user)) {
      data.requester_type = 'STUDENT';
      const children = (await childrenOf(req.user)).map((c) => c.id);
      if (!children.includes(Number(data.student_id))) throw forbidden('You may only raise leave for your own child');
    } else if (isTeacher(req.user) && data.requester_type === 'FACULTY') {
      data.faculty_id = await facultyIdOf(req.user);
    }
    return data;
  },
  // Requesters see their own; approvers see everything they may approve.
  scopeClause: async (req) => {
    if (req.permissions.has('leave.approve') || isAdmin(req.user)) return null;
    if (isStudent(req.user)) return { clause: 'lr.student_id = ?', params: [await studentIdOf(req.user) ?? 0] };
    if (isParent(req.user)) {
      const ids = (await childrenOf(req.user)).map((c) => c.id);
      if (!ids.length) return { clause: '1 = 0', params: [] };
      return { clause: `lr.student_id IN (${ids.map(() => '?').join(',')})`, params: ids };
    }
    const facultyId = await facultyIdOf(req.user);
    return { clause: 'lr.faculty_id = ?', params: [facultyId ?? 0] };
  },
});

/** Approve or reject — the approver must hold leave.approve. */
leaveRouter.post(
  '/:id/review',
  requirePermission('leave.approve'),
  validateBody(
    z.object({
      status: z.enum(['APPROVED', 'REJECTED']),
      review_remarks: z.string().max(400).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const leave = plain(await LeaveRequest.findById(oid(id)));
    if (!leave) throw notFound('Leave request not found');
    if (!isAdmin(req.user) && !sameId(leave.campus_id, req.user.campus_id)) throw forbidden('Different campus');
    if (leave.status !== 'PENDING') throw badRequest(`This request has already been ${leave.status.toLowerCase()}`);

    await LeaveRequest.updateOne({ _id: oid(id) }, {
      $set: {
        status: req.body.status,
        reviewed_by: oid(req.user.id),
        reviewed_at: new Date().toISOString(),
        review_remarks: req.body.review_remarks,
      },
    });

    // Approved pupil leave is reflected in the attendance register.
    if (req.body.status === 'APPROVED' && leave.requester_type === 'STUDENT' && leave.student_id) {
      const student = await Student.findById(oid(leave.student_id)).select('section_id').lean();

      /*
       * One upsert per day of the leave, on the same four fields the register
       * itself uses. A day already marked is corrected rather than doubled —
       * which is what the read-then-write did, without the gap between them.
       */
      let cursor = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        await Attendance.updateOne(
          { student_id: oid(leave.student_id), attendance_date: day, period: 0, course_id: null },
          {
            $set: { status: 'ABSENT', remarks: 'Approved leave', marked_by: oid(req.user.id) },
            $setOnInsert: {
              campus_id: oid(leave.campus_id),
              section_id: student?.section_id ?? null,
            },
          },
          { upsert: true }
        );
        cursor = new Date(cursor.getTime() + 86400000);
      }
    }

    if (leave.raised_by) {
      await notify({
        userId: leave.raised_by,
        campusId: leave.campus_id,
        type: 'LEAVE_' + req.body.status,
        title: `Leave ${req.body.status.toLowerCase()}`,
        body: `Your leave request for ${leave.from_date} to ${leave.to_date} was ${req.body.status.toLowerCase()}.`,
        link: '/leave',
        entityType: 'LeaveRequest',
        entityId: id,
      });
    }

    await logActivity({
      req,
      action: req.body.status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      module: 'leave',
      entityType: 'Leave Request',
      entityId: id,
      description: `${req.body.status} leave request #${id}`,
      oldValues: { status: leave.status },
      newValues: { status: req.body.status, remarks: req.body.review_remarks },
    });

    return ok(res, plain(await LeaveRequest.findById(oid(id))));
  })
);
router.use('/leave', leaveRouter);

export default router;
