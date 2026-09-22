/**
 * The document model.
 *
 * Generated from server/src/db/schema.pg.sql — sixty-six collections, two
 * hundred references and sixty-five enumerations, carried across exactly as the
 * relational schema stated them rather than retyped from memory.
 *
 * One thing does not survive the crossing. A foreign key is a promise the
 * database keeps: PostgreSQL will not record a mark against a pupil who is not
 * there. `ref` makes no such promise — it only tells populate() where to look,
 * and MongoDB will happily store a reference to nothing. Every one of those two
 * hundred promises is now the application's to keep, which is what
 * db/mongo/integrity.js is for.
 *
 * Regenerate with: node scripts/generate-models.mjs
 */
import mongoose from 'mongoose';
import { enforceReferences } from './integrity.js';

const { Schema, Types } = mongoose;

/** Every collection carries created_at/updated_at, as the tables did. */
const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
};

export const models = {};

const define = (name, collection, definition, indexes = []) => {
  const schema = new Schema(definition, { ...options, collection });
  for (const ix of indexes) schema.index(...ix);

  /*
   * Presented as `id`, a string, exactly as the relational API always was.
   * That the identifier is now an ObjectId is the database's business; the
   * portal, the tests and every stored link were written against `id`.
   */
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const [k, v] of Object.entries(ret)) {
        if (v instanceof Types.ObjectId) ret[k] = String(v);
      }
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true });

  /*
   * The foreign keys, kept in the schema. Both this and the transform above
   * must be attached before the model is compiled: mongoose reads a schema
   * once, and anything added afterwards is silently ignored — which is exactly
   * the kind of guarantee that looks present and is not.
   */
  enforceReferences(schema, name);

  models[name] = mongoose.models[name] || mongoose.model(name, schema);
  return models[name];
};

/* campuses */
export const Campus = define('Campus', 'campuses', {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    phone: { type: String },
    email: { type: String },
    principal: { type: String },
    logo: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* roles */
export const Role = define('Role', 'roles', {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    level: { type: Number, required: true, default: 50 },
    is_system: { type: Number, required: true, default: 0 },
});

/* permissions */
export const Permission = define('Permission', 'permissions', {
    code: { type: String, required: true, unique: true },
    module: { type: String, required: true },
    action: { type: String, required: true },
    description: { type: String },
});

/* role_permissions */
export const RolePermission = define('RolePermission', 'role_permissions', {
    role_id: { type: Types.ObjectId, ref: 'Role', required: true, index: true },
    permission_id: { type: Types.ObjectId, ref: 'Permission', required: true, index: true },
});

/* users */
export const User = define('User', 'users', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', index: true },
    role_id: { type: Types.ObjectId, ref: 'Role', required: true, index: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    full_name: { type: String, required: true },
    phone: { type: String },
    photo: { type: String },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    must_change_password: { type: Number, required: true, default: 0 },
    failed_attempts: { type: Number, required: true, default: 0 },
    locked_until: { type: String },
    last_login_at: { type: String },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* user_permissions */
export const UserPermission = define('UserPermission', 'user_permissions', {
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    permission_id: { type: Types.ObjectId, ref: 'Permission', required: true, index: true },
    effect: { type: String, required: true, enum: ['ALLOW', 'DENY'], default: 'ALLOW' },
    granted_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* refresh_tokens */
export const RefreshToken = define('RefreshToken', 'refresh_tokens', {
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    user_agent: { type: String },
    ip_address: { type: String },
    expires_at: { type: String, required: true },
    revoked_at: { type: String },
});

/* departments */
export const Department = define('Department', 'departments', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    head_faculty_id: { type: Number },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* administrators */
export const Administrator = define('Administrator', 'administrators', {
    user_id: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    employee_code: { type: String, required: true, unique: true },
    designation: { type: String },
    board: { type: String, required: true, enum: ['STATE', 'CBSE', 'BOTH'], default: 'BOTH' },
    department_id: { type: Types.ObjectId, ref: 'Department', index: true },
    date_of_joining: { type: String },
    qualification: { type: String },
    address: { type: String },
    emergency_contact: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* faculty */
export const Faculty = define('Faculty', 'faculty', {
    user_id: { type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    faculty_code: { type: String, required: true, unique: true },
    staff_type: { type: String, required: true, enum: ['TEACHING', 'FINANCIAL'] },
    board: { type: String, required: true, enum: ['STATE', 'CBSE', 'BOTH'], default: 'BOTH' },
    department_id: { type: Types.ObjectId, ref: 'Department', index: true },
    designation: { type: String },
    qualification: { type: String },
    specialization: { type: String },
    experience_years: { type: Number, default: 0 },
    date_of_birth: { type: String },
    date_of_joining: { type: String },
    blood_group: { type: String },
    address: { type: String },
    emergency_contact: { type: String },
    bank_account: { type: String },
    pan_number: { type: String },
    is_mentor: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED'], default: 'ACTIVE' },
});

/* academic_years */
export const AcademicYear = define('AcademicYear', 'academic_years', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    name: { type: String, required: true },
    start_date: { type: String, required: true },
    end_date: { type: String, required: true },
    is_current: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, enum: ['ACTIVE', 'CLOSED', 'UPCOMING'], default: 'ACTIVE' },
});

/* classes */
export const Class = define('Class', 'classes', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    name: { type: String, required: true },
    numeric_level: { type: Number },
    stream: { type: String },
    board: { type: String, required: true, enum: ['STATE', 'CBSE'], default: 'STATE' },
    class_teacher_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* sections */
export const Section = define('Section', 'sections', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', required: true, index: true },
    name: { type: String, required: true },
    capacity: { type: Number, required: true, default: 40 },
    room_number: { type: String },
    section_teacher_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* subjects */
export const Subject = define('Subject', 'subjects', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    department_id: { type: Types.ObjectId, ref: 'Department', index: true },
    type: { type: String, required: true, enum: ['CORE', 'ELECTIVE', 'LANGUAGE', 'LAB', 'ACTIVITY'], default: 'CORE' },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* courses */
export const Course = define('Course', 'courses', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    subject_id: { type: Types.ObjectId, ref: 'Subject', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    credits: { type: Number, required: true, default: 4 },
    max_marks: { type: Number, required: true, default: 100 },
    pass_marks: { type: Number, required: true, default: 35 },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
});

/* course_assignments */
export const CourseAssignment = define('CourseAssignment', 'course_assignments', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', required: true, index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    is_primary: { type: Number, required: true, default: 1 },
    assigned_by: { type: Types.ObjectId, ref: 'User', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* students */
export const Student = define('Student', 'students', {
    user_id: { type: Types.ObjectId, ref: 'User', unique: true, index: true },
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    admission_number: { type: String, required: true, unique: true },
    roll_number: { type: String },
    first_name: { type: String, required: true },
    last_name: { type: String },
    date_of_birth: { type: String },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    blood_group: { type: String },
    photo: { type: String },
    class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', index: true },
    board: { type: String, required: true, enum: ['STATE', 'CBSE'], default: 'STATE' },
    mentor_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    nationality: { type: String, default: 'Indian' },
    religion: { type: String },
    category: { type: String },
    aadhaar_number: { type: String },
    previous_school: { type: String },
    admission_date: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE', 'ALUMNI', 'TRANSFERRED', 'SUSPENDED'], default: 'ACTIVE' },
});

/* parents */
export const Parent = define('Parent', 'parents', {
    user_id: { type: Types.ObjectId, ref: 'User', unique: true, index: true },
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    parent_code: { type: String, required: true, unique: true },
    father_name: { type: String },
    father_occupation: { type: String },
    father_phone: { type: String },
    mother_name: { type: String },
    mother_occupation: { type: String },
    mother_phone: { type: String },
    guardian_name: { type: String },
    relation: { type: String, default: 'FATHER' },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    annual_income: { type: Number },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* student_parents */
export const StudentParent = define('StudentParent', 'student_parents', {
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    parent_id: { type: Types.ObjectId, ref: 'Parent', required: true, index: true },
    relation: { type: String, required: true, default: 'FATHER' },
    is_primary: { type: Number, required: true, default: 1 },
});

/* enrollments */
export const Enrollment = define('Enrollment', 'enrollments', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', required: true, index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', required: true, index: true },
    roll_number: { type: String },
    enrollment_date: { type: String, required: true },
    promoted_from: { type: Types.ObjectId, ref: 'Class', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'COMPLETED', 'WITHDRAWN'], default: 'ACTIVE' },
    remarks: { type: String },
});

/* documents */
export const Document = define('Document', 'documents', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    owner_type: { type: String, required: true, enum: ['STUDENT', 'FACULTY', 'ADMINISTRATOR', 'PARENT'] },
    owner_id: { type: Number, required: true },
    title: { type: String, required: true },
    document_type: { type: String },
    file_path: { type: String, required: true },
    file_name: { type: String },
    file_size: { type: Number },
    mime_type: { type: String },
    uploaded_by: { type: Types.ObjectId, ref: 'User', index: true },
    verified: { type: Number, required: true, default: 0 },
});

/* attendance */
export const Attendance = define('Attendance', 'attendance', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', index: true },
    attendance_date: { type: String, required: true },
    period: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, enum: ['PRESENT', 'ABSENT'] },
    remarks: { type: String },
    marked_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* faculty_attendance */
export const FacultyAttendance = define('FacultyAttendance', 'faculty_attendance', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', required: true, index: true },
    attendance_date: { type: String, required: true },
    status: { type: String, required: true, enum: ['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY'] },
    remarks: { type: String },
    marked_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* leave_requests */
export const LeaveRequest = define('LeaveRequest', 'leave_requests', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    requester_type: { type: String, required: true, enum: ['STUDENT', 'FACULTY'] },
    student_id: { type: Types.ObjectId, ref: 'Student', index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    raised_by: { type: Types.ObjectId, ref: 'User', index: true },
    leave_type: { type: String, required: true, default: 'CASUAL' },
    from_date: { type: String, required: true },
    to_date: { type: String, required: true },
    days: { type: Number },
    reason: { type: String, required: true },
    attachment: { type: String },
    status: { type: String, required: true, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
    reviewed_by: { type: Types.ObjectId, ref: 'User', index: true },
    reviewed_at: { type: String },
    review_remarks: { type: String },
});

/* examinations */
export const Examination = define('Examination', 'examinations', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    name: { type: String, required: true },
    exam_type: { type: String, required: true, enum: ['UNIT_TEST', 'TERM', 'MID_TERM', 'FINAL', 'PRACTICAL', 'ASSIGNMENT'], default: 'TERM' },
    start_date: { type: String },
    end_date: { type: String },
    description: { type: String },
    weightage: { type: Number, default: 100 },
    status: { type: String, required: true, enum: ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'RESULTS_PUBLISHED'], default: 'SCHEDULED' },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* exam_subjects */
export const ExamSubject = define('ExamSubject', 'exam_subjects', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    examination_id: { type: Types.ObjectId, ref: 'Examination', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    exam_date: { type: String },
    start_time: { type: String },
    end_time: { type: String },
    room: { type: String },
    max_marks: { type: Number, required: true, default: 100 },
    pass_marks: { type: Number, required: true, default: 35 },
    invigilator_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
});

/* grades */
export const Grade = define('Grade', 'grades', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String },
    min_percent: { type: Number, required: true },
    max_percent: { type: Number, required: true },
    grade_point: { type: Number },
    remarks: { type: String },
});

/* marks */
export const Mark = define('Mark', 'marks', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    examination_id: { type: Types.ObjectId, ref: 'Examination', required: true, index: true },
    exam_subject_id: { type: Types.ObjectId, ref: 'ExamSubject', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    marks_obtained: { type: Number },
    max_marks: { type: Number, required: true, default: 100 },
    grade: { type: String },
    is_absent: { type: Number, required: true, default: 0 },
    remarks: { type: String },
    status: { type: String, required: true, enum: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'], default: 'DRAFT' },
    entered_by: { type: Types.ObjectId, ref: 'User', index: true },
    submitted_at: { type: String },
    approved_by: { type: Types.ObjectId, ref: 'User', index: true },
    approved_at: { type: String },
    rejection_reason: { type: String },
});

/* results */
export const Result = define('Result', 'results', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    examination_id: { type: Types.ObjectId, ref: 'Examination', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    total_marks: { type: Number },
    obtained_marks: { type: Number },
    percentage: { type: Number },
    grade: { type: String },
    rank_in_class: { type: Number },
    attendance_percent: { type: Number },
    result_status: { type: String, enum: ['PASS', 'FAIL', 'PENDING'] },
    remarks: { type: String },
    published: { type: Number, required: true, default: 0 },
    published_by: { type: Types.ObjectId, ref: 'User', index: true },
    published_at: { type: String },
});

/* timetables */
export const Timetable = define('Timetable', 'timetables', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', required: true, index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    day_of_week: { type: Number, required: true },
    period: { type: Number, required: true },
    start_time: { type: String, required: true },
    end_time: { type: String, required: true },
    room: { type: String },
});

/* course_materials */
export const CourseMaterial = define('CourseMaterial', 'course_materials', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    course_id: { type: Types.ObjectId, ref: 'Course', required: true, index: true },
    section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    material_type: { type: String, required: true, enum: ['NOTES', 'PDF', 'PRESENTATION', 'VIDEO', 'LINK', 'ASSIGNMENT', 'OTHER'], default: 'NOTES' },
    file_path: { type: String },
    file_name: { type: String },
    file_size: { type: Number },
    external_url: { type: String },
    due_date: { type: String },
    is_published: { type: Number, required: true, default: 1 },
});

/* mentoring_records */
export const MentoringRecord = define('MentoringRecord', 'mentoring_records', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    mentor_id: { type: Types.ObjectId, ref: 'Faculty', required: true, index: true },
    record_type: { type: String, required: true, enum: ['GUIDANCE', 'REMARK', 'MEETING', 'ACHIEVEMENT', 'CONCERN'], default: 'GUIDANCE' },
    title: { type: String, required: true },
    notes: { type: String },
    meeting_date: { type: String },
    action_items: { type: String },
    follow_up_date: { type: String },
    visible_to_parent: { type: Number, required: true, default: 1 },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* fee_categories */
export const FeeCategory = define('FeeCategory', 'fee_categories', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    is_recurring: { type: Number, required: true, default: 0 },
    frequency: { type: String, enum: ['ANNUAL', 'TERM', 'MONTHLY', 'ONE_TIME'], default: 'ANNUAL' },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* fee_structures */
export const FeeStructure = define('FeeStructure', 'fee_structures', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    fee_category_id: { type: Types.ObjectId, ref: 'FeeCategory', required: true, index: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    due_date: { type: String },
    late_fee_per_day: { type: Number, default: 0 },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* student_fees */
export const StudentFee = define('StudentFee', 'student_fees', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    fee_structure_id: { type: Types.ObjectId, ref: 'FeeStructure', required: true, index: true },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', required: true, index: true },
    total_amount: { type: Number, required: true },
    discount_amount: { type: Number, required: true, default: 0 },
    concession_reason: { type: String },
    paid_amount: { type: Number, required: true, default: 0 },
    due_date: { type: String },
    status: { type: String, required: true, enum: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED'], default: 'PENDING' },
});

/* fee_payments */
export const FeePayment = define('FeePayment', 'fee_payments', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_fee_id: { type: Types.ObjectId, ref: 'StudentFee', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    amount: { type: Number, required: true },
    payment_date: { type: String, required: true },
    payment_mode: { type: String, required: true, enum: ['CASH', 'CHEQUE', 'ONLINE', 'UPI', 'CARD', 'NEFT', 'DD'], default: 'CASH' },
    transaction_ref: { type: String },
    bank_name: { type: String },
    remarks: { type: String },
    status: { type: String, required: true, enum: ['SUCCESS', 'PENDING', 'FAILED', 'REFUNDED'], default: 'SUCCESS' },
    collected_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* fee_receipts */
export const FeeReceipt = define('FeeReceipt', 'fee_receipts', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    fee_payment_id: { type: Types.ObjectId, ref: 'FeePayment', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    receipt_number: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    amount_in_words: { type: String },
    issued_by: { type: Types.ObjectId, ref: 'User', index: true },
    issued_at: { type: String, required: true },
    cancelled: { type: Number, required: true, default: 0 },
});

/* income */
export const Income = define('Income', 'income', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    income_date: { type: String, required: true },
    payment_mode: { type: String, default: 'CASH' },
    reference: { type: String },
    description: { type: String },
    recorded_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* expenses */
export const Expense = define('Expense', 'expenses', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    expense_date: { type: String, required: true },
    payment_mode: { type: String, default: 'CASH' },
    vendor: { type: String },
    bill_number: { type: String },
    attachment: { type: String },
    description: { type: String },
    approved_by: { type: Types.ObjectId, ref: 'User', index: true },
    status: { type: String, required: true, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'APPROVED' },
    recorded_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* petty_cash */
export const PettyCash = define('PettyCash', 'petty_cash', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    entry_date: { type: String, required: true },
    entry_type: { type: String, required: true, enum: ['IN', 'OUT'] },
    amount: { type: Number, required: true },
    purpose: { type: String, required: true },
    balance_after: { type: Number },
    handled_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* salary_structures */
export const SalaryStructure = define('SalaryStructure', 'salary_structures', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    basic_salary: { type: Number, required: true, default: 0 },
    hra: { type: Number, required: true, default: 0 },
    da: { type: Number, required: true, default: 0 },
    conveyance: { type: Number, required: true, default: 0 },
    medical: { type: Number, required: true, default: 0 },
    other_allowances: { type: Number, required: true, default: 0 },
    pf_deduction: { type: Number, required: true, default: 0 },
    tax_deduction: { type: Number, required: true, default: 0 },
    other_deductions: { type: Number, required: true, default: 0 },
    effective_from: { type: String, required: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* payroll */
export const Payroll = define('Payroll', 'payroll', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    basic_salary: { type: Number, required: true, default: 0 },
    total_allowances: { type: Number, required: true, default: 0 },
    total_deductions: { type: Number, required: true, default: 0 },
    working_days: { type: Number, default: 0 },
    present_days: { type: Number, default: 0 },
    lop_days: { type: Number, default: 0 },
    gross_salary: { type: Number, required: true, default: 0 },
    net_salary: { type: Number, required: true, default: 0 },
    payslip_number: { type: String, unique: true },
    payment_date: { type: String },
    payment_mode: { type: String, default: 'NEFT' },
    status: { type: String, required: true, enum: ['DRAFT', 'PROCESSED', 'PAID', 'HOLD'], default: 'DRAFT' },
    processed_by: { type: Types.ObjectId, ref: 'User', index: true },
    remarks: { type: String },
});

/* vehicles */
export const Vehicle = define('Vehicle', 'vehicles', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    vehicle_number: { type: String, required: true, unique: true },
    vehicle_type: { type: String, required: true, enum: ['BUS', 'VAN', 'CAR', 'MINI_BUS'], default: 'BUS' },
    model: { type: String },
    capacity: { type: Number, required: true, default: 40 },
    registration_date: { type: String },
    insurance_expiry: { type: String },
    fitness_expiry: { type: String },
    gps_device_id: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'], default: 'ACTIVE' },
});

/* drivers */
export const Driver = define('Driver', 'drivers', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    license_number: { type: String, required: true },
    license_expiry: { type: String },
    address: { type: String },
    photo: { type: String },
    date_of_joining: { type: String },
    salary: { type: Number, default: 0 },
    vehicle_id: { type: Types.ObjectId, ref: 'Vehicle', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* routes */
export const Route = define('Route', 'routes', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    route_code: { type: String, required: true },
    name: { type: String, required: true },
    start_point: { type: String },
    end_point: { type: String },
    distance_km: { type: Number },
    stops: { type: String },
    vehicle_id: { type: Types.ObjectId, ref: 'Vehicle', index: true },
    driver_id: { type: Types.ObjectId, ref: 'Driver', index: true },
    fare: { type: Number, default: 0 },
    morning_start: { type: String },
    evening_start: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* transport_allocations */
export const TransportAllocation = define('TransportAllocation', 'transport_allocations', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', required: true, index: true },
    route_id: { type: Types.ObjectId, ref: 'Route', required: true, index: true },
    vehicle_id: { type: Types.ObjectId, ref: 'Vehicle', index: true },
    pickup_point: { type: String },
    drop_point: { type: String },
    pickup_time: { type: String },
    drop_time: { type: String },
    academic_year_id: { type: Types.ObjectId, ref: 'AcademicYear', index: true },
    fare: { type: Number, default: 0 },
    status: { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
});

/* fuel_records */
export const FuelRecord = define('FuelRecord', 'fuel_records', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    vehicle_id: { type: Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    fuel_date: { type: String, required: true },
    litres: { type: Number, required: true },
    rate_per_litre: { type: Number, required: true },
    total_cost: { type: Number, required: true },
    odometer: { type: Number },
    filled_by: { type: String },
    bill_number: { type: String },
    recorded_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* vehicle_maintenance */
export const VehicleMaintenance = define('VehicleMaintenance', 'vehicle_maintenance', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    vehicle_id: { type: Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    service_date: { type: String, required: true },
    service_type: { type: String, required: true },
    description: { type: String },
    cost: { type: Number, required: true, default: 0 },
    garage: { type: String },
    next_service_date: { type: String },
    recorded_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* driver_attendance */
export const DriverAttendance = define('DriverAttendance', 'driver_attendance', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    driver_id: { type: Types.ObjectId, ref: 'Driver', required: true, index: true },
    attendance_date: { type: String, required: true },
    status: { type: String, required: true, enum: ['PRESENT', 'ABSENT', 'LEAVE'] },
    remarks: { type: String },
});

/* books */
export const Book = define('Book', 'books', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    isbn: { type: String },
    title: { type: String, required: true },
    author: { type: String },
    publisher: { type: String },
    category: { type: String },
    edition: { type: String },
    language: { type: String, default: 'English' },
    rack_number: { type: String },
    total_copies: { type: Number, required: true, default: 1 },
    available_copies: { type: Number, required: true, default: 1 },
    price: { type: Number, default: 0 },
    purchase_date: { type: String },
    status: { type: String, required: true, enum: ['ACTIVE', 'LOST', 'DAMAGED', 'ARCHIVED'], default: 'ACTIVE' },
});

/* book_transactions */
export const BookTransaction = define('BookTransaction', 'book_transactions', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    book_id: { type: Types.ObjectId, ref: 'Book', required: true, index: true },
    member_type: { type: String, required: true, enum: ['STUDENT', 'FACULTY'], default: 'STUDENT' },
    student_id: { type: Types.ObjectId, ref: 'Student', index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    issue_date: { type: String, required: true },
    due_date: { type: String, required: true },
    return_date: { type: String },
    status: { type: String, required: true, enum: ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'], default: 'ISSUED' },
    issued_by: { type: Types.ObjectId, ref: 'User', index: true },
    remarks: { type: String },
});

/* fines */
export const Fine = define('Fine', 'fines', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    book_transaction_id: { type: Types.ObjectId, ref: 'BookTransaction', index: true },
    student_id: { type: Types.ObjectId, ref: 'Student', index: true },
    faculty_id: { type: Types.ObjectId, ref: 'Faculty', index: true },
    fine_type: { type: String, required: true, default: 'LATE_RETURN' },
    amount: { type: Number, required: true },
    reason: { type: String },
    paid: { type: Number, required: true, default: 0 },
    paid_date: { type: String },
    collected_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* inventory_categories */
export const InventoryCategory = define('InventoryCategory', 'inventory_categories', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
});

/* inventory_items */
export const InventoryItem = define('InventoryItem', 'inventory_items', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    category_id: { type: Types.ObjectId, ref: 'InventoryCategory', required: true, index: true },
    item_code: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String },
    quantity: { type: Number, required: true, default: 0 },
    unit: { type: String, default: 'PCS' },
    reorder_level: { type: Number, default: 0 },
    location: { type: String },
    condition_status: { type: String, enum: ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'], default: 'GOOD' },
    purchase_date: { type: String },
    vendor: { type: String },
    unit_cost: { type: Number, default: 0 },
    department_id: { type: Types.ObjectId, ref: 'Department', index: true },
    status: { type: String, required: true, enum: ['ACTIVE', 'CONSUMED', 'DISPOSED'], default: 'ACTIVE' },
});

/* purchases */
export const Purchase = define('Purchase', 'purchases', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    purchase_order: { type: String },
    item_id: { type: Types.ObjectId, ref: 'InventoryItem', index: true },
    item_name: { type: String, required: true },
    vendor: { type: String },
    quantity: { type: Number, required: true, default: 1 },
    unit_cost: { type: Number, required: true, default: 0 },
    total_cost: { type: Number, required: true, default: 0 },
    purchase_date: { type: String, required: true },
    invoice_number: { type: String },
    status: { type: String, required: true, enum: ['ORDERED', 'RECEIVED', 'CANCELLED'], default: 'RECEIVED' },
    recorded_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* assets */
export const Asset = define('Asset', 'assets', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    asset_code: { type: String, required: true },
    name: { type: String, required: true },
    asset_type: { type: String },
    serial_number: { type: String },
    purchase_date: { type: String },
    purchase_cost: { type: Number, default: 0 },
    current_value: { type: Number, default: 0 },
    vendor: { type: String },
    location: { type: String },
    department_id: { type: Types.ObjectId, ref: 'Department', index: true },
    assigned_to: { type: Types.ObjectId, ref: 'User', index: true },
    condition_status: { type: String, default: 'GOOD' },
    warranty_expiry: { type: String },
    status: { type: String, required: true, enum: ['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED'], default: 'IN_USE' },
});

/* announcements */
export const Announcement = define('Announcement', 'announcements', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    category: { type: String, default: 'GENERAL' },
    priority: { type: String, required: true, enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
    target_type: { type: String, required: true, enum: ['ALL', 'STUDENTS', 'PARENTS', 'FACULTY', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'ADMINISTRATORS', 'CLASS', 'SECTION'], default: 'ALL' },
    target_class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    target_section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    attachment: { type: String },
    publish_date: { type: String, required: true },
    expiry_date: { type: String },
    is_published: { type: Number, required: true, default: 0 },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* notices */
export const Notice = define('Notice', 'notices', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    notice_number: { type: String },
    title: { type: String, required: true },
    content: { type: String, required: true },
    target_type: { type: String, required: true, enum: ['ALL', 'STUDENTS', 'PARENTS', 'FACULTY', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'ADMINISTRATORS', 'CLASS', 'SECTION'], default: 'ALL' },
    target_class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    target_section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    attachment: { type: String },
    notice_date: { type: String, required: true },
    expiry_date: { type: String },
    is_published: { type: Number, required: true, default: 0 },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* circulars */
export const Circular = define('Circular', 'circulars', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    circular_number: { type: String },
    title: { type: String, required: true },
    content: { type: String, required: true },
    target_type: { type: String, required: true, enum: ['ALL', 'STUDENTS', 'PARENTS', 'FACULTY', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'ADMINISTRATORS', 'CLASS', 'SECTION'], default: 'ALL' },
    target_class_id: { type: Types.ObjectId, ref: 'Class', index: true },
    target_section_id: { type: Types.ObjectId, ref: 'Section', index: true },
    attachment: { type: String },
    issue_date: { type: String, required: true },
    is_published: { type: Number, required: true, default: 0 },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* messages */
export const Message = define('Message', 'messages', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    sender_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    recipient_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    parent_message_id: { type: Types.ObjectId, ref: 'Message', index: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    attachment: { type: String },
    context_student_id: { type: Types.ObjectId, ref: 'Student', index: true },
    is_read: { type: Number, required: true, default: 0 },
    read_at: { type: String },
    sender_deleted: { type: Number, required: true, default: 0 },
    recipient_deleted: { type: Number, required: true, default: 0 },
});

/* notifications */
export const Notification = define('Notification', 'notifications', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', index: true },
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String },
    link: { type: String },
    entity_type: { type: String },
    entity_id: { type: Number },
    is_read: { type: Number, required: true, default: 0 },
    read_at: { type: String },
});

/* events */
export const Event = define('Event', 'events', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    event_type: { type: String, required: true, enum: ['EVENT', 'HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'PTM'], default: 'EVENT' },
    start_date: { type: String, required: true },
    end_date: { type: String },
    start_time: { type: String },
    end_time: { type: String },
    venue: { type: String },
    target_type: { type: String, required: true, default: 'ALL' },
    banner: { type: String },
    is_published: { type: Number, required: true, default: 0 },
    created_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* activity_logs */
export const ActivityLog = define('ActivityLog', 'activity_logs', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', index: true },
    user_id: { type: Types.ObjectId, ref: 'User', index: true },
    user_name: { type: String },
    role_code: { type: String },
    action: { type: String, required: true },
    module: { type: String },
    entity_type: { type: String },
    entity_id: { type: Number },
    description: { type: String },
    old_values: { type: String },
    new_values: { type: String },
    ip_address: { type: String },
    user_agent: { type: String },
    status: { type: String, required: true, enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' },
});

/* system_settings */
export const SystemSetting = define('SystemSetting', 'system_settings', {
    campus_id: { type: Types.ObjectId, ref: 'Campus', index: true },
    category: { type: String, required: true, default: 'GENERAL' },
    key: { type: String, required: true },
    value: { type: String },
    value_type: { type: String, required: true, enum: ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'], default: 'STRING' },
    label: { type: String },
    description: { type: String },
    is_public: { type: Number, required: true, default: 0 },
    updated_by: { type: Types.ObjectId, ref: 'User', index: true },
});

/* password_reset_requests */
export const PasswordResetRequest = define('PasswordResetRequest', 'password_reset_requests', {
    user_id: { type: Types.ObjectId, ref: 'User', index: true },
    submitted_login: { type: String, required: true },
    contact: { type: String },
    reason: { type: String },
    status: { type: String, required: true, enum: ['PENDING', 'COMPLETED', 'REJECTED'], default: 'PENDING' },
    handled_by: { type: Types.ObjectId, ref: 'User', index: true },
    handled_at: { type: String },
    handled_note: { type: String },
    ip_address: { type: String },
});

/* push_subscriptions */
export const PushSubscription = define('PushSubscription', 'push_subscriptions', {
    user_id: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    user_agent: { type: String },
    last_used_at: { type: String },
    failures: { type: Number, required: true, default: 0 },
});

/** Every model by its collection name, for the generic data layer. */
export const byCollection = Object.fromEntries(
  Object.values(models).map((m) => [m.collection.collectionName, m])
);

export default models;
