/**
 * Bulk import from a spreadsheet.
 *
 * A school does not enter five hundred pupils one form at a time. The office
 * already holds them in a spreadsheet, so the portal takes that spreadsheet.
 *
 * Three things make this safe enough to hand to an administrator:
 *
 *   Nothing is written until it has been seen. Every upload is checked and
 *   reported first — row by row, with the reason a row cannot be accepted and
 *   the identifiers that would be issued — and only a second, explicit request
 *   writes anything.
 *
 *   Identifiers are generated, never trusted. Admission numbers, faculty codes
 *   and usernames are allocated from `lib/codes.js`, which cannot repeat one
 *   within the file or against what is already stored.
 *
 *   It is all or nothing. The write runs in one transaction, so a failure on
 *   row four hundred leaves the school exactly where it started rather than
 *   half-imported.
 *
 * Names, not numbers, in the file: an office knows "Class 5" and "A", not that
 * the section is id 17. Lookups resolve what a person would actually type.
 */
import { Router } from 'express';
import { all, get, insert, run, transaction } from '../db/connection.js';
import { asyncHandler, ok } from '../lib/http.js';
import { badRequest } from '../lib/errors.js';
import { requireRole, requirePermission } from '../middleware/auth.js';
import { spreadsheetUpload } from '../middleware/upload.js';
import { parseCsv, toCsv, normaliseHeader } from '../lib/csv.js';
import { admissionNumbers, facultyCodes, parentCodes, usernameAllocator } from '../lib/codes.js';
import { hashPassword } from '../lib/auth.js';
import { logActivity } from '../lib/audit.js';
import { ROLES } from '../lib/permissions.js';
import env from '../config/env.js';

const router = Router();

// The whole section is the Admin's. Bulk-creating people is not something to
// reach by accident, and the per-entity permission is checked as well.
router.use(requireRole(ROLES.ADMIN));

/* ===================================================================== */
/*  HELPERS                                                              */
/* ===================================================================== */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accept the date shapes a spreadsheet actually produces. */
function readDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (DATE.test(text)) return text;
  // 05/09/2026 and 05-09-2026 are day-first here, as they are written locally.
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return undefined; // undefined means "given, but not a date"
}

const readEnum = (value, allowed, fallback) => {
  if (!value) return fallback;
  const found = allowed.find((a) => a.toLowerCase() === String(value).trim().toLowerCase());
  return found ?? undefined;
};

const readBool = (value, fallback = false) => {
  if (value === '' || value === undefined || value === null) return fallback;
  return /^(y|yes|true|1)$/i.test(String(value).trim());
};

const readInt = (value) => {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Index a lookup list by everything a person might reasonably write. */
function index(rows, keys) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const value = row[key];
      if (value === null || value === undefined || value === '') continue;
      const k = String(value).trim().toLowerCase();
      if (!map.has(k)) map.set(k, row);
    }
  }
  return map;
}

/* ===================================================================== */
/*  WHAT CAN BE IMPORTED                                                 */
/* ===================================================================== */

const ENTITIES = {
  students: {
    label: 'Students',
    permission: 'students.create',
    describes: 'One row per pupil. A parent named in the row is created and linked.',
    generated: ['Admission number', 'Sign-in username (parent)', 'Record id'],
    columns: [
      { key: 'first_name', label: 'First Name', required: true, example: 'Aarav' },
      { key: 'last_name', label: 'Last Name', example: 'Kulkarni' },
      { key: 'class', label: 'Class', required: true, hint: 'e.g. Class 5', example: 'Class 5' },
      { key: 'section', label: 'Section', hint: 'e.g. A', example: 'A' },
      { key: 'roll_number', label: 'Roll Number', example: '12' },
      { key: 'gender', label: 'Gender', hint: 'MALE / FEMALE / OTHER', example: 'MALE' },
      { key: 'date_of_birth', label: 'Date of Birth', hint: 'YYYY-MM-DD', example: '2015-06-14' },
      { key: 'blood_group', label: 'Blood Group', example: 'O+' },
      { key: 'phone', label: 'Phone', example: '9876543210' },
      { key: 'email', label: 'Email', example: '' },
      { key: 'address', label: 'Address', example: 'Station Road' },
      { key: 'city', label: 'City', example: 'Raichur' },
      { key: 'state', label: 'State', example: 'Karnataka' },
      { key: 'pincode', label: 'Pincode', example: '584101' },
      { key: 'religion', label: 'Religion', example: '' },
      { key: 'category', label: 'Category', example: '' },
      { key: 'aadhaar_number', label: 'Aadhaar Number', example: '' },
      { key: 'previous_school', label: 'Previous School', example: '' },
      { key: 'admission_date', label: 'Admission Date', hint: 'YYYY-MM-DD, defaults to today', example: '' },
      { key: 'father_name', label: 'Father Name', example: 'Ramesh Kulkarni' },
      { key: 'mother_name', label: 'Mother Name', example: 'Sunita Kulkarni' },
      { key: 'parent_phone', label: 'Parent Phone', example: '9876543211' },
      { key: 'parent_email', label: 'Parent Email', example: '' },
      { key: 'parent_account', label: 'Create Parent Login', hint: 'YES / NO', example: 'YES' },
    ],

    async prepare(campusId) {
      const classes = await all(
        `SELECT id, name, board, numeric_level FROM classes WHERE campus_id = ? AND status = 'ACTIVE'`,
        [campusId]
      );
      const sections = await all(
        `SELECT s.id, s.name, s.class_id FROM sections s
           JOIN classes c ON c.id = s.class_id
          WHERE s.campus_id = ? AND s.status = 'ACTIVE'`,
        [campusId]
      );
      const year = await get(
        `SELECT id FROM academic_years WHERE campus_id = ? AND is_current = 1`,
        [campusId]
      );
      return {
        classes,
        classIndex: index(classes, ['name']),
        sections,
        academicYearId: year?.id ?? null,
        admissions: await admissionNumbers(campusId),
        parents: await parentCodes(campusId),
        usernames: await usernameAllocator(),
        parentRole: await get("SELECT id FROM roles WHERE code = 'PARENT'"),
      };
    },

    validate(values, ctx) {
      const errors = [];
      const data = {};

      data.first_name = values.first_name;
      if (!data.first_name) errors.push('First Name is required');
      data.last_name = values.last_name || null;

      const klass = ctx.classIndex.get(String(values.class || '').trim().toLowerCase());
      if (!values.class) errors.push('Class is required');
      else if (!klass) errors.push(`No active class called "${values.class}"`);
      data.class_id = klass?.id ?? null;
      data.board = klass?.board ?? 'STATE';

      // Only check the section once the class is known — otherwise an unknown
      // class produces two complaints about the same mistake.
      data.section_id = null;
      if (klass && values.section) {
        const section = ctx.sections.find(
          (s) => s.class_id === klass.id
            && s.name.trim().toLowerCase() === String(values.section).trim().toLowerCase()
        );
        if (!section) errors.push(`Class "${values.class}" has no section "${values.section}"`);
        data.section_id = section?.id ?? null;
      }

      const gender = readEnum(values.gender, ['MALE', 'FEMALE', 'OTHER'], null);
      if (gender === undefined) errors.push(`Gender must be MALE, FEMALE or OTHER (got "${values.gender}")`);
      data.gender = gender;

      for (const [field, label] of [['date_of_birth', 'Date of Birth'], ['admission_date', 'Admission Date']]) {
        const date = readDate(values[field]);
        if (date === undefined) errors.push(`${label} is not a date: "${values[field]}"`);
        data[field] = date;
      }

      for (const field of ['roll_number', 'blood_group', 'phone', 'email', 'address', 'city',
        'state', 'pincode', 'religion', 'category', 'aadhaar_number', 'previous_school']) {
        data[field] = values[field] || null;
      }

      data.parent = (values.father_name || values.mother_name || values.parent_phone)
        ? {
          father_name: values.father_name || null,
          mother_name: values.mother_name || null,
          phone: values.parent_phone || null,
          email: values.parent_email || null,
          create_account: readBool(values.parent_account, true),
        }
        : null;

      return { data, errors };
    },

    /** What this row will be given, shown in the preview before anything is written. */
    plan(data, ctx) {
      const admission = ctx.admissions.take();
      const planned = { admission_number: admission };
      if (data.parent?.create_account) {
        planned.parent_username = ctx.usernames.take(`p${admission.replace(/[^a-z0-9]/gi, '')}`, 'parent');
        planned.parent_code = ctx.parents.take();
      } else if (data.parent) {
        planned.parent_code = ctx.parents.take();
      }
      return planned;
    },

    async write(data, planned, ctx, req, campusId) {
      const studentId = await insert('students', {
        campus_id: campusId,
        admission_number: planned.admission_number,
        roll_number: data.roll_number,
        first_name: data.first_name,
        last_name: data.last_name,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        blood_group: data.blood_group,
        class_id: data.class_id,
        section_id: data.section_id,
        academic_year_id: ctx.academicYearId,
        board: data.board,
        phone: data.phone,
        email: data.email,
        address: data.address,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        religion: data.religion,
        category: data.category,
        aadhaar_number: data.aadhaar_number,
        previous_school: data.previous_school,
        admission_date: data.admission_date || new Date().toISOString().slice(0, 10),
        status: 'ACTIVE',
      });

      if (ctx.academicYearId && data.class_id && data.section_id) {
        await run(
          `INSERT INTO enrollments (campus_id, student_id, academic_year_id, class_id, section_id, roll_number)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          [campusId, studentId, ctx.academicYearId, data.class_id, data.section_id, data.roll_number]
        );
      }

      if (data.parent) {
        let parentUserId = null;
        if (planned.parent_username) {
          parentUserId = await insert('users', {
            username: planned.parent_username,
            email: data.parent.email || `${planned.parent_username}@parent.vignan.edu`,
            password_hash: ctx.passwordHash,
            full_name: data.parent.father_name || data.parent.mother_name || 'Parent',
            phone: data.parent.phone,
            role_id: ctx.parentRole.id,
            campus_id: campusId,
            status: 'ACTIVE',
            must_change_password: 1,
            created_by: req.user.id,
          });
        }
        const parentId = await insert('parents', {
          user_id: parentUserId,
          campus_id: campusId,
          parent_code: planned.parent_code,
          father_name: data.parent.father_name,
          mother_name: data.parent.mother_name,
          phone: data.parent.phone,
          email: data.parent.email,
          relation: 'FATHER',
          address: data.address,
        });
        await run(
          `INSERT INTO student_parents (student_id, parent_id, relation, is_primary)
           VALUES (?, ?, 'FATHER', 1) ON CONFLICT DO NOTHING`,
          [studentId, parentId]
        );
      }

      return { id: studentId, reference: planned.admission_number };
    },
  },

  faculty: {
    label: 'Faculty',
    permission: 'faculty.create',
    describes: 'One row per member of staff. Each is given a sign-in account.',
    generated: ['Faculty code', 'Sign-in username', 'Record id'],
    columns: [
      { key: 'full_name', label: 'Full Name', required: true, example: 'Kavitha Nadgouda' },
      { key: 'staff_type', label: 'Staff Type', hint: 'TEACHING / FINANCIAL', example: 'TEACHING' },
      { key: 'designation', label: 'Designation', example: 'Assistant Teacher' },
      { key: 'department', label: 'Department', hint: 'must already exist', example: '' },
      { key: 'board', label: 'Department Wing', hint: 'STATE / CBSE / BOTH', example: 'BOTH' },
      { key: 'qualification', label: 'Qualification', example: 'M.Sc, B.Ed' },
      { key: 'specialization', label: 'Specialisation', example: 'Mathematics' },
      { key: 'experience_years', label: 'Experience (years)', example: '6' },
      { key: 'gender', label: 'Gender', hint: 'MALE / FEMALE / OTHER', example: 'FEMALE' },
      { key: 'phone', label: 'Phone', example: '9876543210' },
      { key: 'email', label: 'Email', example: '' },
      { key: 'date_of_joining', label: 'Date of Joining', hint: 'YYYY-MM-DD', example: '2024-06-01' },
    ],

    async prepare(campusId) {
      const departments = await all('SELECT id, name, code FROM departments WHERE campus_id = ?', [campusId]);
      return {
        departments,
        departmentIndex: index(departments, ['name', 'code']),
        teaching: await facultyCodes(campusId, 'TEACHING'),
        financial: await facultyCodes(campusId, 'FINANCIAL'),
        usernames: await usernameAllocator(),
        teachingRole: await get("SELECT id FROM roles WHERE code = 'TEACHING_STAFF'"),
        financialRole: await get("SELECT id FROM roles WHERE code = 'FINANCIAL_STAFF'"),
      };
    },

    validate(values, ctx) {
      const errors = [];
      const data = {};

      data.full_name = values.full_name;
      if (!data.full_name) errors.push('Full Name is required');

      const staffType = readEnum(values.staff_type, ['TEACHING', 'FINANCIAL'], 'TEACHING');
      if (staffType === undefined) errors.push(`Staff Type must be TEACHING or FINANCIAL (got "${values.staff_type}")`);
      data.staff_type = staffType;

      const board = readEnum(values.board, ['STATE', 'CBSE', 'BOTH'], 'BOTH');
      if (board === undefined) errors.push(`Department Wing must be STATE, CBSE or BOTH (got "${values.board}")`);
      data.board = board;

      const gender = readEnum(values.gender, ['MALE', 'FEMALE', 'OTHER'], null);
      if (gender === undefined) errors.push(`Gender must be MALE, FEMALE or OTHER (got "${values.gender}")`);
      data.gender = gender;

      if (values.department) {
        const department = ctx.departmentIndex.get(String(values.department).trim().toLowerCase());
        if (!department) errors.push(`No department called "${values.department}"`);
        data.department_id = department?.id ?? null;
      } else {
        data.department_id = null;
      }

      const joined = readDate(values.date_of_joining);
      if (joined === undefined) errors.push(`Date of Joining is not a date: "${values.date_of_joining}"`);
      data.date_of_joining = joined;

      const years = readInt(values.experience_years);
      if (years === undefined) errors.push(`Experience must be a number: "${values.experience_years}"`);
      data.experience_years = years;

      for (const field of ['designation', 'qualification', 'specialization', 'phone', 'email']) {
        data[field] = values[field] || null;
      }

      return { data, errors };
    },

    plan(data, ctx) {
      return {
        faculty_code: (data.staff_type === 'TEACHING' ? ctx.teaching : ctx.financial).take(),
        username: ctx.usernames.take(data.full_name, 'staff'),
      };
    },

    async write(data, planned, ctx, req, campusId) {
      const roleId = data.staff_type === 'TEACHING' ? ctx.teachingRole.id : ctx.financialRole.id;
      const userId = await insert('users', {
        username: planned.username,
        email: data.email || `${planned.username}@vignan.edu`,
        password_hash: ctx.passwordHash,
        full_name: data.full_name,
        phone: data.phone,
        gender: data.gender,
        role_id: roleId,
        campus_id: campusId,
        status: 'ACTIVE',
        must_change_password: 1,
        created_by: req.user.id,
      });

      const facultyId = await insert('faculty', {
        user_id: userId,
        campus_id: campusId,
        faculty_code: planned.faculty_code,
        staff_type: data.staff_type,
        board: data.board,
        department_id: data.department_id,
        designation: data.designation,
        qualification: data.qualification,
        specialization: data.specialization,
        experience_years: data.experience_years,
        date_of_joining: data.date_of_joining || new Date().toISOString().slice(0, 10),
        status: 'ACTIVE',
      });

      return { id: facultyId, reference: planned.faculty_code };
    },
  },
};

const entityOr404 = (key) => {
  const entity = ENTITIES[key];
  if (!entity) throw badRequest(`Nothing called "${key}" can be imported`);
  return entity;
};

/* ===================================================================== */
/*  WHAT IS ON OFFER                                                     */
/* ===================================================================== */

router.get(
  '/',
  asyncHandler(async (req, res) =>
    ok(res, Object.entries(ENTITIES).map(([key, entity]) => ({
      key,
      label: entity.label,
      describes: entity.describes,
      generated: entity.generated,
      permitted: req.permissions.has(entity.permission),
      columns: entity.columns,
    })))
  )
);

/** A template with the headings, the hints, and one filled-in example row. */
router.get(
  '/:entity/template',
  asyncHandler(async (req, res) => {
    const entity = entityOr404(req.params.entity);
    const headers = entity.columns.map((c) => c.label);
    const example = {};
    for (const column of entity.columns) example[column.label] = column.example ?? '';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-template.csv"`);
    return res.send(toCsv(headers, [example]));
  })
);

/* ===================================================================== */
/*  CHECKING, THEN WRITING                                               */
/* ===================================================================== */

router.post(
  '/:entity',
  spreadsheetUpload.single('file'),
  asyncHandler(async (req, res) => {
    const key = req.params.entity;
    const entity = entityOr404(key);
    if (!req.permissions.has(entity.permission)) {
      throw badRequest(`You do not have permission to create ${entity.label.toLowerCase()}`);
    }
    if (!req.file) throw badRequest('Attach a .csv file');

    const campusId = req.body.campus_id ? Number(req.body.campus_id) : req.user.campus_id;
    if (!campusId) throw badRequest('No campus is associated with your account');

    const commit = /^(true|1|yes)$/i.test(String(req.body.commit || ''));
    const skipInvalid = /^(true|1|yes)$/i.test(String(req.body.skip_invalid || ''));

    const { headers, rows } = parseCsv(req.file.buffer.toString('utf8'));
    if (!rows.length) throw badRequest('That file has no rows under its headings');

    // A heading is matched by its printed label as well as by its field name,
    // so both "Create Parent Login" and "parent_account" reach the same field —
    // the template prints labels, but an office spreadsheet may use either.
    const alias = new Map();
    for (const column of entity.columns) {
      alias.set(column.key, column.key);
      alias.set(normaliseHeader(column.label), column.key);
    }

    // Say plainly which headings were not recognised rather than ignoring them:
    // a misspelt "Frist Name" would otherwise silently import blank names.
    const unknown = headers.filter((h) => h && !alias.has(normaliseHeader(h)));
    const missing = entity.columns.filter(
      (c) => c.required && !headers.some((h) => alias.get(normaliseHeader(h)) === c.key)
    );
    if (missing.length) {
      throw badRequest(`The file is missing required column(s): ${missing.map((c) => c.label).join(', ')}`);
    }

    const ctx = await entity.prepare(campusId);

    // Every account created here gets the same starting password and is made to
    // change it at first sign-in — the office hands it over in person.
    ctx.passwordHash = await hashPassword(env.seedPassword);

    const checked = [];
    for (const { line, values } of rows) {
      // Re-key each row from whatever the heading was to the field it names.
      const named = {};
      for (const [header, value] of Object.entries(values)) {
        const key = alias.get(header);
        if (key) named[key] = value;
      }
      const { data, errors } = entity.validate(named, ctx);
      // Identifiers are allocated for valid rows only, so a rejected row does
      // not consume an admission number.
      const planned = errors.length ? null : entity.plan(data, ctx);
      checked.push({ line, data, planned, errors });
    }

    const valid = checked.filter((r) => !r.errors.length);
    const invalid = checked.filter((r) => r.errors.length);

    const report = {
      entity: key,
      label: entity.label,
      committed: false,
      total: checked.length,
      valid: valid.length,
      invalid: invalid.length,
      unknownColumns: unknown,
      rows: checked.slice(0, 200).map((r) => ({
        line: r.line,
        errors: r.errors,
        summary: summarise(key, r.data),
        generated: r.planned,
      })),
      truncated: checked.length > 200,
    };

    if (!commit) return ok(res, report);

    if (invalid.length && !skipInvalid) {
      throw badRequest(
        `${invalid.length} of ${checked.length} row(s) cannot be imported. `
        + 'Correct them, or choose to skip them.'
      );
    }
    if (!valid.length) throw badRequest('There is nothing left to import');

    // One transaction: a failure part-way leaves the school where it started.
    const written = await transaction(async () => {
      const results = [];
      for (const row of valid) {
        results.push(await entity.write(row.data, row.planned, ctx, req, campusId));
      }
      return results;
    })();

    await logActivity({
      req,
      action: 'IMPORT',
      module: key === 'faculty' ? 'faculty' : 'students',
      entityType: entity.label,
      description: `Imported ${written.length} ${entity.label.toLowerCase()} from ${req.file.originalname}`
        + (invalid.length ? ` (${invalid.length} row(s) skipped)` : ''),
      newValues: { file: req.file.originalname, imported: written.length, skipped: invalid.length },
    });

    return ok(res, {
      ...report,
      committed: true,
      imported: written.length,
      references: written.map((w) => w.reference),
    });
  })
);

/** A short human description of a row, for the preview table. */
function summarise(key, data) {
  if (!data) return '';
  if (key === 'students') return `${data.first_name || ''} ${data.last_name || ''}`.trim();
  return data.full_name || '';
}

export default router;
