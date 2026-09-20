/**
 * Module catalogue.
 *
 * Each entry is a declarative description of one ERP resource — endpoint,
 * table columns, form fields and filters — rendered by <ResourcePage />.
 * Bespoke workflows (attendance marking, marks approval, fee collection,
 * report cards) have their own pages instead.
 */
import { Link } from 'react-router-dom';
import { Avatar, Badge, formatCurrency, formatDate, formatDateTime, fileSize } from './components/ui.jsx';
import { Icon } from './components/Icon.jsx';

/* ------------------------------------------------------------ helpers */
/** Class options labelled with their department, so "Class 8" is unambiguous. */
const classOpt = (list = []) =>
  list.map((c) => ({
    value: c.id,
    label: `${c.name}${c.board ? ` · ${c.board === 'CBSE' ? 'CBSE' : 'State'}` : ''}`,
  }));

/** Section options labelled with class and department. */
const sectionOpt = (list = []) =>
  list.map((sec) => ({
    value: sec.id,
    label: `${sec.class_name || ''} ${sec.name}${sec.board ? ` · ${sec.board === 'CBSE' ? 'CBSE' : 'State'}` : ''}`.trim(),
  }));

const opt = (list, labelKey = 'name', valueKey = 'id') =>
  (list || []).map((item) => ({ value: item[valueKey], label: item[labelKey] }));

const statusOptions = (values) => values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));

/**
 * The school runs two departments (examination boards) side by side.
 * Admin and Administrator see and manage both; these helpers give every
 * relevant screen the same column, filter and form control.
 */
const BOARD_LABEL = { STATE: 'State Board', CBSE: 'CBSE', BOTH: 'Both departments' };
const BOARD_OPTIONS = [
  { value: 'STATE', label: 'State Board' },
  { value: 'CBSE', label: 'CBSE' },
];
const BOARD_OPTIONS_WITH_BOTH = [...BOARD_OPTIONS, { value: 'BOTH', label: 'Both departments' }];

const boardCol = (key = 'board', label = 'Department') => ({
  key,
  label,
  render: (row) =>
    row[key] ? (
      <Badge tone={row[key] === 'CBSE' ? 'purple' : 'info'} dot={false}>
        {BOARD_LABEL[row[key]] || row[key]}
      </Badge>
    ) : (
      '—'
    ),
});

const boardField = (options = BOARD_OPTIONS, extra = {}) => ({
  name: 'board',
  label: 'Department',
  type: 'select',
  options,
  ...extra,
});

const badgeCol = (key = 'status', label = 'Status') => ({
  key,
  label,
  badge: true,
  render: (row) => (row[key] ? <Badge status={row[key]}>{row[key]}</Badge> : '—'),
});

const dateCol = (key, label) => ({ key, label, render: (row) => formatDate(row[key]), sortable: true });
const moneyCol = (key, label) => ({ key, label, numeric: true, sortable: true, render: (row) => formatCurrency(row[key]) });

const personCol = (nameFn, subFn, photoKey = 'photo') => ({
  key: 'person',
  label: 'Name',
  render: (row) => (
    <div className="row-person">
      <Avatar name={nameFn(row)} src={row[photoKey]} size="sm" />
      <div style={{ minWidth: 0 }}>
        <div className="cell-primary truncate">{nameFn(row)}</div>
        <div className="cell-sub truncate">{subFn(row)}</div>
      </div>
    </div>
  ),
});

/* ================================================================
   ACADEMIC STRUCTURE
   ================================================================ */
export const academicYears = {
  title: 'Academic Years',
  subtitle: 'Multiple years run side by side; previous records stay available.',
  endpoint: '/academics/academic-years',
  module: 'academics',
  searchPlaceholder: 'Search academic years...',
  columns: [
    { key: 'name', label: 'Academic Year', sortable: true, render: (row) => (
      <span className="row" style={{ gap: 8 }}>
        <span className="cell-primary">{row.name}</span>
        {!!row.is_current && <Badge tone="success" dot={false}>Current</Badge>}
      </span>
    ) },
    dateCol('start_date', 'Starts'),
    dateCol('end_date', 'Ends'),
    { key: 'class_count', label: 'Classes', numeric: true },
    { key: 'enrollment_count', label: 'Enrolments', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'name', label: 'Name', required: true, placeholder: '2026-27' },
    { name: 'start_date', label: 'Start date', type: 'date', required: true },
    { name: 'end_date', label: 'End date', type: 'date', required: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'UPCOMING', 'CLOSED']), default: 'ACTIVE' },
    { name: 'is_current', label: 'Current year', type: 'checkbox', checkboxLabel: 'Mark as the current academic year' },
  ],
  filters: [{ name: 'status', label: 'status', options: statusOptions(['ACTIVE', 'UPCOMING', 'CLOSED']) }],
};

export const classes = {
  departmentScoped: true,
  title: 'Classes',
  subtitle: 'Class levels for the selected academic year.',
  endpoint: '/academics/classes',
  module: 'academics',
  searchPlaceholder: 'Search classes...',
  columns: [
    { key: 'name', label: 'Class', sortable: true, render: (row) => <span className="cell-primary">{row.name}</span> },
    boardCol(),
    { key: 'numeric_level', label: 'Level', numeric: true, sortable: true },
    { key: 'stream', label: 'Stream', render: (row) => row.stream || '—' },
    { key: 'academic_year_name', label: 'Academic Year' },
    { key: 'class_teacher_name', label: 'Class Teacher', render: (row) => row.class_teacher_name || '—' },
    { key: 'section_count', label: 'Sections', numeric: true },
    { key: 'student_count', label: 'Students', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'name', label: 'Class name', required: true, placeholder: 'Class 8' },
    boardField(BOARD_OPTIONS, { required: true, default: 'STATE', hint: 'Which department this class belongs to' }),
    { name: 'numeric_level', label: 'Numeric level', type: 'number', placeholder: '8' },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'stream', label: 'Stream', placeholder: 'Optional' },
    { name: 'class_teacher_id', label: 'Class teacher', type: 'select', options: (l) => opt(l.teachingStaff, 'full_name') },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'academic_year_id', label: 'years', options: (l) => opt(l.academicYears) },
    { name: 'status', label: 'status', options: statusOptions(['ACTIVE', 'INACTIVE']) },
  ],
};

export const sections = {
  departmentScoped: true,
  title: 'Sections',
  subtitle: 'Divisions within each class, with capacity and room allocation.',
  endpoint: '/academics/sections',
  module: 'academics',
  searchPlaceholder: 'Search sections...',
  columns: [
    { key: 'name', label: 'Section', sortable: true, render: (row) => (
      <span className="cell-primary">{row.class_name} — {row.name}</span>
    ) },
    boardCol(),
    { key: 'room_number', label: 'Room', render: (row) => row.room_number || '—' },
    { key: 'section_teacher_name', label: 'Section Teacher', render: (row) => row.section_teacher_name || '—' },
    { key: 'student_count', label: 'Students', numeric: true },
    { key: 'capacity', label: 'Capacity', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: (l) => classOpt(l.classes) },
    { name: 'name', label: 'Section name', required: true, placeholder: 'A' },
    { name: 'capacity', label: 'Capacity', type: 'number', default: 40 },
    { name: 'room_number', label: 'Room number' },
    { name: 'section_teacher_id', label: 'Section teacher', type: 'select', options: (l) => opt(l.teachingStaff, 'full_name') },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [{ name: 'class_id', label: 'classes', options: (l) => classOpt(l.classes) }],
};

export const subjects = {
  title: 'Subjects',
  subtitle: 'The subject catalogue shared across classes.',
  endpoint: '/academics/subjects',
  module: 'academics',
  searchPlaceholder: 'Search subjects...',
  columns: [
    { key: 'code', label: 'Code', sortable: true, render: (row) => <span className="mono">{row.code}</span> },
    { key: 'name', label: 'Subject', sortable: true, render: (row) => <span className="cell-primary">{row.name}</span> },
    { key: 'type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.type}</Badge> },
    { key: 'department_name', label: 'Department', render: (row) => row.department_name || '—' },
    { key: 'course_count', label: 'Courses', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'code', label: 'Subject code', required: true, placeholder: 'MATH' },
    { name: 'name', label: 'Subject name', required: true },
    { name: 'type', label: 'Type', type: 'select', options: statusOptions(['CORE', 'ELECTIVE', 'LANGUAGE', 'LAB', 'ACTIVITY']), default: 'CORE' },
    { name: 'department_id', label: 'Department', type: 'select', options: (l) => opt(l.departments) },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'type', label: 'types', options: statusOptions(['CORE', 'ELECTIVE', 'LANGUAGE', 'LAB', 'ACTIVITY']) },
    { name: 'department_id', label: 'departments', options: (l) => opt(l.departments) },
  ],
};

export const courses = {
  departmentScoped: true,
  title: 'Courses',
  subtitle: 'A subject taught to a specific class in an academic year.',
  endpoint: '/academics/courses',
  module: 'courses',
  searchPlaceholder: 'Search courses...',
  columns: [
    { key: 'code', label: 'Code', sortable: true, render: (row) => <span className="mono">{row.code}</span> },
    { key: 'name', label: 'Course', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub">{row.subject_name}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class' },
    boardCol(),
    { key: 'academic_year_name', label: 'Year' },
    { key: 'max_marks', label: 'Max Marks', numeric: true },
    { key: 'assignment_count', label: 'Teachers', numeric: true },
    { key: 'material_count', label: 'Materials', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'code', label: 'Course code', required: true, placeholder: 'MATH-8' },
    { name: 'name', label: 'Course name', required: true },
    { name: 'subject_id', label: 'Subject', type: 'select', required: true, options: (l) => opt(l.subjects) },
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: (l) => classOpt(l.classes) },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'credits', label: 'Credits', type: 'number', default: 4 },
    { name: 'max_marks', label: 'Maximum marks', type: 'number', default: 100 },
    { name: 'pass_marks', label: 'Pass marks', type: 'number', default: 35 },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE', 'ARCHIVED']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'class_id', label: 'classes', options: (l) => classOpt(l.classes) },
    { name: 'subject_id', label: 'subjects', options: (l) => opt(l.subjects) },
  ],
};

export const courseAssignments = {
  departmentScoped: true,
  title: 'Course Assignments',
  subtitle: 'The link that governs what each teacher may access. Only teaching staff can be assigned.',
  endpoint: '/academics/course-assignments',
  module: 'courses',
  createLabel: 'Assign Course',
  searchPlaceholder: 'Search assignments...',
  columns: [
    { key: 'faculty_name', label: 'Teacher', render: (row) => (
      <div>
        <div className="cell-primary">{row.faculty_name}</div>
        <div className="cell-sub mono">{row.faculty_code}</div>
      </div>
    ) },
    { key: 'course_name', label: 'Course', render: (row) => (
      <div>
        <div className="cell-primary">{row.subject_name}</div>
        <div className="cell-sub">{row.course_code}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name} ${row.section_name}` },
    { key: 'is_primary', label: 'Primary', render: (row) => (row.is_primary ? <Badge tone="info" dot={false}>Primary</Badge> : '—') },
    badgeCol(),
  ],
  fields: [
    { name: 'course_id', label: 'Course', type: 'select', required: true, options: (l) => opt(l.courses) },
    { name: 'faculty_id', label: 'Teacher', type: 'select', required: true, options: (l) => opt(l.teachingStaff, 'full_name'), hint: 'Only teaching staff appear here' },
    { name: 'section_id', label: 'Section', type: 'select', required: true, options: (l) => sectionOpt(l.sections) },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'is_primary', label: 'Primary teacher', type: 'checkbox', checkboxLabel: 'This is the primary teacher', default: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'faculty_id', label: 'teachers', options: (l) => opt(l.teachingStaff, 'full_name') },
    { name: 'course_id', label: 'courses', options: (l) => opt(l.courses) },
  ],
};

export const departments = {
  title: 'Subject Departments',
  subtitle: 'Subject departments such as Science and Mathematics — distinct from the State/CBSE departments.',
  endpoint: '/academics/departments',
  module: 'departments',
  columns: [
    { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
    { key: 'name', label: 'Department', sortable: true, render: (row) => <span className="cell-primary">{row.name}</span> },
    { key: 'head_name', label: 'Head', render: (row) => row.head_name || '—' },
    { key: 'faculty_count', label: 'Faculty', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Department name', required: true },
    { name: 'head_faculty_id', label: 'Head of department', type: 'select', options: (l) => opt(l.teachingStaff, 'full_name') },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
};

export const grades = {
  title: 'Grade Bands',
  subtitle: 'Percentage ranges mapped to grades and grade points.',
  endpoint: '/academics/grades',
  module: 'examinations',
  createLabel: 'Add Grade',
  columns: [
    { key: 'code', label: 'Grade', sortable: true, render: (row) => <Badge tone="info" dot={false}>{row.code}</Badge> },
    { key: 'name', label: 'Description' },
    { key: 'min_percent', label: 'From %', numeric: true, sortable: true },
    { key: 'max_percent', label: 'To %', numeric: true },
    { key: 'grade_point', label: 'Grade Point', numeric: true },
    { key: 'remarks', label: 'Remarks' },
  ],
  fields: [
    { name: 'code', label: 'Grade code', required: true, placeholder: 'A+' },
    { name: 'name', label: 'Description', placeholder: 'Outstanding' },
    { name: 'min_percent', label: 'Minimum %', type: 'number', required: true, step: '0.01' },
    { name: 'max_percent', label: 'Maximum %', type: 'number', required: true, step: '0.01' },
    { name: 'grade_point', label: 'Grade point', type: 'number', step: '0.1' },
    { name: 'remarks', label: 'Remarks', full: true },
  ],
};

export const timetable = {
  title: 'Timetable',
  subtitle: 'Period allocation per section. Teacher clashes are rejected automatically.',
  endpoint: '/academics/timetable',
  module: 'timetable',
  createLabel: 'Add Slot',
  defaultSort: { column: 'day_of_week', order: 'asc' },
  columns: [
    { key: 'day_of_week', label: 'Day', sortable: true, render: (row) => ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][row.day_of_week] },
    { key: 'period', label: 'Period', numeric: true, sortable: true },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'course_name', label: 'Course', render: (row) => row.subject_name || row.course_name || '—' },
    { key: 'faculty_name', label: 'Teacher', render: (row) => row.faculty_name || '—' },
    { key: 'start_time', label: 'Time', render: (row) => `${row.start_time} – ${row.end_time}` },
    { key: 'room', label: 'Room', render: (row) => row.room || '—' },
  ],
  fields: [
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: (l) => classOpt(l.classes) },
    { name: 'section_id', label: 'Section', type: 'select', required: true, options: (l) => sectionOpt(l.sections) },
    { name: 'course_id', label: 'Course', type: 'select', options: (l) => opt(l.courses) },
    { name: 'faculty_id', label: 'Teacher', type: 'select', options: (l) => opt(l.teachingStaff, 'full_name') },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    {
      name: 'day_of_week',
      label: 'Day',
      type: 'select',
      required: true,
      // A day the school does not teach on has nothing to timetable.
      options: (l) =>
        (l.weekdays || []).filter((d) => (l.periodsPerDay || {})[d.day] > 0).map((d) => ({ value: d.day, label: d.name })),
    },
    {
      name: 'period',
      label: 'Period',
      type: 'select',
      required: true,
      // Bounded by how many periods that particular day runs.
      options: (l, form) => {
        const count = (l.periodsPerDay || {})[form?.day_of_week] ?? 0;
        return Array.from({ length: count }, (_, i) => ({ value: i + 1, label: `Period ${i + 1}` }));
      },
      hint: 'Choose the day first — the periods offered follow it.',
    },
    { name: 'start_time', label: 'Start time', type: 'time', required: true },
    { name: 'end_time', label: 'End time', type: 'time', required: true },
    { name: 'room', label: 'Room' },
  ],
  filters: [
    { name: 'section_id', label: 'sections', options: (l) => sectionOpt(l.sections) },
    { name: 'faculty_id', label: 'teachers', options: (l) => opt(l.teachingStaff, 'full_name') },
  ],
};

export const enrollments = {
  departmentScoped: true,
  title: 'Student Enrollment',
  subtitle: 'Year-by-year enrolment history for every student.',
  endpoint: '/academics/enrollments',
  module: 'enrollments',
  columns: [
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    boardCol(),
    { key: 'academic_year_name', label: 'Academic Year' },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name} ${row.section_name}` },
    { key: 'roll_number', label: 'Roll No' },
    dateCol('enrollment_date', 'Enrolled On'),
    badgeCol(),
  ],
  fields: [
    { name: 'student_id', label: 'Student ID', type: 'number', required: true },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'class_id', label: 'Class', type: 'select', required: true, options: (l) => classOpt(l.classes) },
    { name: 'section_id', label: 'Section', type: 'select', required: true, options: (l) => sectionOpt(l.sections) },
    { name: 'roll_number', label: 'Roll number' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'COMPLETED', 'WITHDRAWN']), default: 'ACTIVE' },
    { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
  ],
  filters: [
    { name: 'academic_year_id', label: 'years', options: (l) => opt(l.academicYears) },
    { name: 'class_id', label: 'classes', options: (l) => classOpt(l.classes) },
  ],
};

/* ================================================================
   EXAMINATIONS
   ================================================================ */
export const examinations = {
  title: 'Examinations',
  subtitle: 'Create examinations, then schedule subjects and publish results.',
  endpoint: '/exams/examinations',
  module: 'examinations',
  createLabel: 'Create Exam',
  columns: [
    { key: 'name', label: 'Examination', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub">{row.exam_type.replace(/_/g, ' ')} · {row.academic_year_name}</div>
      </div>
    ) },
    dateCol('start_date', 'Starts'),
    dateCol('end_date', 'Ends'),
    { key: 'subject_count', label: 'Subjects', numeric: true },
    { key: 'pending_approval', label: 'Pending', numeric: true, render: (row) => row.pending_approval ? <Badge tone="warning" dot={false}>{row.pending_approval}</Badge> : '—' },
    { key: 'published_results', label: 'Published', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'name', label: 'Examination name', required: true, placeholder: 'Half-Yearly Examination 2025' },
    { name: 'exam_type', label: 'Type', type: 'select', required: true, options: statusOptions(['UNIT_TEST', 'TERM', 'MID_TERM', 'FINAL', 'PRACTICAL', 'ASSIGNMENT']), default: 'TERM' },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'end_date', label: 'End date', type: 'date' },
    { name: 'weightage', label: 'Weightage (%)', type: 'number', default: 100 },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'RESULTS_PUBLISHED']), default: 'SCHEDULED' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
  filters: [
    { name: 'exam_type', label: 'types', options: statusOptions(['UNIT_TEST', 'TERM', 'MID_TERM', 'FINAL', 'PRACTICAL']) },
    { name: 'status', label: 'status', options: statusOptions(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'RESULTS_PUBLISHED']) },
  ],
};

export const examSchedule = {
  title: 'Examination Schedule',
  subtitle: 'Date, time, room and invigilator for each paper.',
  endpoint: '/exams/exam-subjects',
  module: 'examinations',
  createLabel: 'Add Paper',
  columns: [
    { key: 'exam_name', label: 'Examination' },
    { key: 'subject_name', label: 'Subject', render: (row) => (
      <div>
        <div className="cell-primary">{row.subject_name}</div>
        <div className="cell-sub">{row.course_code}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class' },
    dateCol('exam_date', 'Date'),
    { key: 'start_time', label: 'Time', render: (row) => row.start_time ? `${row.start_time} – ${row.end_time}` : '—' },
    { key: 'room', label: 'Room', render: (row) => row.room || '—' },
    { key: 'max_marks', label: 'Max', numeric: true },
    { key: 'invigilator_name', label: 'Invigilator', render: (row) => row.invigilator_name || '—' },
  ],
  fields: [
    { name: 'examination_id', label: 'Examination', type: 'select', required: true, options: (l) => opt(l.examinations) },
    { name: 'course_id', label: 'Course', type: 'select', required: true, options: (l) => opt(l.courses) },
    { name: 'class_id', label: 'Class', type: 'select', options: (l) => classOpt(l.classes) },
    { name: 'exam_date', label: 'Exam date', type: 'date' },
    { name: 'start_time', label: 'Start time', type: 'time' },
    { name: 'end_time', label: 'End time', type: 'time' },
    { name: 'room', label: 'Room' },
    { name: 'max_marks', label: 'Maximum marks', type: 'number', default: 100 },
    { name: 'pass_marks', label: 'Pass marks', type: 'number', default: 35 },
    { name: 'invigilator_id', label: 'Invigilator', type: 'select', options: (l) => opt(l.teachingStaff, 'full_name') },
  ],
  filters: [{ name: 'examination_id', label: 'exams', options: (l) => opt(l.examinations) }],
};

export const results = {
  title: 'Results',
  subtitle: 'Computed results with grade, rank and pass status.',
  endpoint: '/exams/results',
  module: 'results',
  readOnly: true,
  exportKey: 'results',
  defaultSort: { column: 'percentage', order: 'desc' },
  columns: [
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'exam_name', label: 'Examination' },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'obtained_marks', label: 'Marks', numeric: true, render: (row) => `${row.obtained_marks ?? 0} / ${row.total_marks ?? 0}` },
    { key: 'percentage', label: '%', numeric: true, sortable: true, render: (row) => <strong>{row.percentage}%</strong> },
    { key: 'grade', label: 'Grade', render: (row) => row.grade ? <Badge tone="info" dot={false}>{row.grade}</Badge> : '—' },
    { key: 'rank_in_class', label: 'Rank', numeric: true },
    { key: 'result_status', label: 'Result', badge: true, render: (row) => <Badge status={row.result_status}>{row.result_status}</Badge> },
    { key: 'published', label: 'Published', render: (row) => row.published ? <Badge tone="success" dot={false}>Published</Badge> : <Badge tone="neutral" dot={false}>Draft</Badge> },
  ],
  filters: [
    { name: 'examination_id', label: 'exams', options: (l) => opt(l.examinations) },
    { name: 'class_id', label: 'classes', options: (l) => classOpt(l.classes) },
    { name: 'result_status', label: 'results', options: statusOptions(['PASS', 'FAIL']) },
  ],
};

/* ================================================================
   ATTENDANCE & LEAVE
   ================================================================ */
export const facultyAttendance = {
  title: 'Faculty Attendance',
  subtitle: 'Daily attendance for teaching and financial staff.',
  endpoint: '/attendance/faculty',
  module: 'faculty_attendance',
  createLabel: 'Mark Attendance',
  defaultSort: { column: 'attendance_date', order: 'desc' },
  columns: [
    { key: 'faculty_name', label: 'Staff', render: (row) => (
      <div>
        <div className="cell-primary">{row.faculty_name}</div>
        <div className="cell-sub mono">{row.faculty_code}</div>
      </div>
    ) },
    { key: 'staff_type', label: 'Category', render: (row) => <Badge status={row.staff_type}>{row.staff_type}</Badge> },
    { key: 'department_name', label: 'Department', render: (row) => row.department_name || '—' },
    dateCol('attendance_date', 'Date'),
    { key: 'check_in', label: 'In', render: (row) => row.check_in || '—' },
    { key: 'check_out', label: 'Out', render: (row) => row.check_out || '—' },
    badgeCol(),
  ],
  fields: [
    { name: 'faculty_id', label: 'Staff member', type: 'select', required: true, options: (l) => [...opt(l.teachingStaff, 'full_name'), ...opt(l.financialStaff, 'full_name')] },
    { name: 'attendance_date', label: 'Date', type: 'date', required: true },
    { name: 'status', label: 'Status', type: 'select', required: true, options: statusOptions(['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY']), default: 'PRESENT' },
    { name: 'check_in', label: 'Check in', type: 'time' },
    { name: 'check_out', label: 'Check out', type: 'time' },
    { name: 'remarks', label: 'Remarks', full: true },
  ],
  filters: [{ name: 'status', label: 'status', options: statusOptions(['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY']) }],
};

/* ================================================================
   FEES & FINANCE
   ================================================================ */
export const feeCategories = {
  title: 'Fee Categories',
  subtitle: 'Fee heads such as tuition, examination and transport.',
  endpoint: '/finance/fee-categories',
  module: 'fees',
  createLabel: 'Add Category',
  columns: [
    { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
    { key: 'name', label: 'Category', sortable: true, render: (row) => <span className="cell-primary">{row.name}</span> },
    { key: 'frequency', label: 'Frequency', render: (row) => <Badge tone="neutral" dot={false}>{row.frequency}</Badge> },
    { key: 'is_recurring', label: 'Recurring', render: (row) => (row.is_recurring ? 'Yes' : 'No') },
    badgeCol(),
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Category name', required: true },
    { name: 'frequency', label: 'Frequency', type: 'select', options: statusOptions(['ANNUAL', 'TERM', 'MONTHLY', 'ONE_TIME']), default: 'ANNUAL' },
    { name: 'is_recurring', label: 'Recurring', type: 'checkbox', checkboxLabel: 'This fee recurs' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
};

export const feeStructures = {
  title: 'Fee Structures',
  subtitle: 'Amounts and due dates per class. Assign a structure to bill students.',
  endpoint: '/finance/fee-structures',
  module: 'fees',
  createLabel: 'Add Fee Structure',
  columns: [
    { key: 'name', label: 'Fee', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub">{row.category_name}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class', render: (row) => row.class_name || 'All classes' },
    moneyCol('amount', 'Amount'),
    dateCol('due_date', 'Due Date'),
    { key: 'assigned_count', label: 'Assigned', numeric: true },
    badgeCol(),
  ],
  fields: [
    { name: 'name', label: 'Fee name', required: true },
    { name: 'fee_category_id', label: 'Category', type: 'select', required: true, options: (l) => opt(l.feeCategories) },
    { name: 'class_id', label: 'Class', type: 'select', options: (l) => classOpt(l.classes) },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: (l) => opt(l.academicYears) },
    { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01' },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'late_fee_per_day', label: 'Late fee per day', type: 'number', default: 0 },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'class_id', label: 'classes', options: (l) => classOpt(l.classes) },
    { name: 'fee_category_id', label: 'categories', options: (l) => opt(l.feeCategories) },
  ],
};

export const studentFees = {
  title: 'Student Fee Details',
  subtitle: 'Billed, discounted, paid and outstanding amounts per student.',
  endpoint: '/finance/student-fees',
  module: 'fees',
  readOnly: true,
  exportKey: 'fees',
  columns: [
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'fee_name', label: 'Fee Head' },
    moneyCol('total_amount', 'Billed'),
    moneyCol('discount_amount', 'Discount'),
    moneyCol('paid_amount', 'Paid'),
    { key: 'balance', label: 'Balance', numeric: true, render: (row) => (
      <strong className={row.balance > 0 ? 'text-danger' : 'text-success'}>{formatCurrency(row.balance)}</strong>
    ) },
    dateCol('due_date', 'Due'),
    badgeCol(),
  ],
  filters: [
    { name: 'status', label: 'status', options: statusOptions(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED']) },
  ],
};

export const feePayments = {
  title: 'Fee Payments',
  subtitle: 'Every collected payment with its receipt.',
  endpoint: '/finance/payments',
  module: 'payments',
  readOnly: true,
  exportKey: 'payments',
  defaultSort: { column: 'payment_date', order: 'desc' },
  columns: [
    { key: 'receipt_number', label: 'Receipt', render: (row) => <span className="mono">{row.receipt_number || '—'}</span> },
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'fee_name', label: 'Fee Head' },
    dateCol('payment_date', 'Date'),
    { key: 'payment_mode', label: 'Mode', render: (row) => <Badge tone="neutral" dot={false}>{row.payment_mode}</Badge> },
    moneyCol('amount', 'Amount'),
    { key: 'collected_by_name', label: 'Collected By', render: (row) => row.collected_by_name || '—' },
    { key: 'receipt', label: '', render: (row) => row.receipt_id ? (
      <Link to={`/receipts/${row.receipt_id}`} className="btn btn-ghost btn-sm"><Icon name="printer" size={14} /></Link>
    ) : null },
  ],
  filters: [
    { name: 'payment_mode', label: 'modes', options: statusOptions(['CASH', 'CHEQUE', 'ONLINE', 'UPI', 'CARD', 'NEFT', 'DD']) },
  ],
};

export const income = {
  title: 'Income',
  subtitle: 'All institutional income, including fee collection.',
  endpoint: '/finance/income',
  module: 'finance',
  createLabel: 'Add Income',
  exportKey: undefined,
  defaultSort: { column: 'income_date', order: 'desc' },
  columns: [
    { key: 'title', label: 'Description', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub">{row.category}</div>
      </div>
    ) },
    dateCol('income_date', 'Date'),
    { key: 'payment_mode', label: 'Mode' },
    { key: 'reference', label: 'Reference', render: (row) => <span className="mono">{row.reference || '—'}</span> },
    moneyCol('amount', 'Amount'),
    { key: 'recorded_by_name', label: 'Recorded By', render: (row) => row.recorded_by_name || '—' },
  ],
  fields: [
    { name: 'title', label: 'Title', required: true },
    { name: 'category', label: 'Category', required: true, placeholder: 'DONATION' },
    { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01' },
    { name: 'income_date', label: 'Date', type: 'date' },
    { name: 'payment_mode', label: 'Payment mode', type: 'select', options: statusOptions(['CASH', 'UPI', 'ONLINE', 'NEFT', 'CHEQUE', 'CARD']) },
    { name: 'reference', label: 'Reference' },
    { name: 'description', label: 'Notes', type: 'textarea', full: true },
  ],
};

export const expenses = {
  title: 'Expenses',
  subtitle: 'Institutional expenditure by category and vendor.',
  endpoint: '/finance/expenses',
  module: 'finance',
  createLabel: 'Add Expense',
  defaultSort: { column: 'expense_date', order: 'desc' },
  columns: [
    { key: 'title', label: 'Description', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub">{row.category}</div>
      </div>
    ) },
    dateCol('expense_date', 'Date'),
    { key: 'vendor', label: 'Vendor', render: (row) => row.vendor || '—' },
    { key: 'bill_number', label: 'Bill No', render: (row) => <span className="mono">{row.bill_number || '—'}</span> },
    moneyCol('amount', 'Amount'),
    badgeCol(),
  ],
  fields: [
    { name: 'title', label: 'Title', required: true },
    { name: 'category', label: 'Category', required: true, placeholder: 'UTILITIES' },
    { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01' },
    { name: 'expense_date', label: 'Date', type: 'date' },
    { name: 'payment_mode', label: 'Payment mode', type: 'select', options: statusOptions(['CASH', 'UPI', 'ONLINE', 'NEFT', 'CHEQUE', 'CARD']) },
    { name: 'vendor', label: 'Vendor' },
    { name: 'bill_number', label: 'Bill number' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['PENDING', 'APPROVED', 'REJECTED']), default: 'APPROVED' },
    { name: 'description', label: 'Notes', type: 'textarea', full: true },
  ],
  filters: [{ name: 'status', label: 'status', options: statusOptions(['PENDING', 'APPROVED', 'REJECTED']) }],
};

export const pettyCash = {
  title: 'Petty Cash',
  subtitle: 'Small cash movements with a running balance.',
  endpoint: '/finance/petty-cash',
  module: 'finance',
  createLabel: 'Add Entry',
  defaultSort: { column: 'entry_date', order: 'desc' },
  columns: [
    dateCol('entry_date', 'Date'),
    { key: 'entry_type', label: 'Type', render: (row) => (
      <Badge tone={row.entry_type === 'IN' ? 'success' : 'danger'} dot={false}>{row.entry_type}</Badge>
    ) },
    { key: 'purpose', label: 'Purpose', render: (row) => <span className="cell-primary">{row.purpose}</span> },
    moneyCol('amount', 'Amount'),
    moneyCol('balance_after', 'Balance'),
    { key: 'handled_by_name', label: 'Handled By', render: (row) => row.handled_by_name || '—' },
  ],
  fields: [
    { name: 'entry_type', label: 'Type', type: 'select', required: true, options: statusOptions(['IN', 'OUT']), default: 'OUT' },
    { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01' },
    { name: 'purpose', label: 'Purpose', required: true, full: true },
    { name: 'entry_date', label: 'Date', type: 'date' },
  ],
  filters: [{ name: 'entry_type', label: 'types', options: statusOptions(['IN', 'OUT']) }],
};

export const salaryStructures = {
  title: 'Salary Structures',
  subtitle: 'Basic pay, allowances and deductions per employee.',
  endpoint: '/finance/salary-structures',
  module: 'payroll',
  createLabel: 'Add Structure',
  columns: [
    { key: 'full_name', label: 'Employee', render: (row) => (
      <div>
        <div className="cell-primary">{row.full_name}</div>
        <div className="cell-sub mono">{row.faculty_code || row.role_code}</div>
      </div>
    ) },
    moneyCol('basic_salary', 'Basic'),
    moneyCol('gross', 'Gross'),
    moneyCol('deductions', 'Deductions'),
    dateCol('effective_from', 'Effective From'),
    badgeCol(),
  ],
  fields: [
    { name: 'user_id', label: 'Employee user ID', type: 'number', required: true, hint: 'The user account this structure applies to' },
    { name: 'basic_salary', label: 'Basic salary', type: 'number', required: true, step: '0.01' },
    { name: 'hra', label: 'HRA', type: 'number', default: 0 },
    { name: 'da', label: 'DA', type: 'number', default: 0 },
    { name: 'conveyance', label: 'Conveyance', type: 'number', default: 0 },
    { name: 'medical', label: 'Medical', type: 'number', default: 0 },
    { name: 'other_allowances', label: 'Other allowances', type: 'number', default: 0 },
    { name: 'pf_deduction', label: 'PF deduction', type: 'number', default: 0 },
    { name: 'tax_deduction', label: 'Tax deduction', type: 'number', default: 0 },
    { name: 'other_deductions', label: 'Other deductions', type: 'number', default: 0 },
    { name: 'effective_from', label: 'Effective from', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
};

/* ================================================================
   TRANSPORT
   ================================================================ */
export const vehicles = {
  title: 'Vehicles',
  subtitle: 'The school fleet, with insurance and fitness expiry tracking.',
  endpoint: '/transport/vehicles',
  module: 'transport',
  createLabel: 'Add Vehicle',
  columns: [
    { key: 'vehicle_number', label: 'Vehicle', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary mono">{row.vehicle_number}</div>
        <div className="cell-sub">{row.model || row.vehicle_type}</div>
      </div>
    ) },
    { key: 'vehicle_type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.vehicle_type}</Badge> },
    { key: 'capacity', label: 'Capacity', numeric: true },
    { key: 'student_count', label: 'Allocated', numeric: true },
    dateCol('insurance_expiry', 'Insurance'),
    dateCol('fitness_expiry', 'Fitness'),
    moneyCol('fuel_cost', 'Fuel Cost'),
    badgeCol(),
  ],
  fields: [
    { name: 'vehicle_number', label: 'Registration number', required: true, placeholder: 'AP07 BX 1234' },
    { name: 'vehicle_type', label: 'Type', type: 'select', options: statusOptions(['BUS', 'MINI_BUS', 'VAN', 'CAR']), default: 'BUS' },
    { name: 'model', label: 'Model' },
    { name: 'capacity', label: 'Capacity', type: 'number', default: 40 },
    { name: 'registration_date', label: 'Registered on', type: 'date' },
    { name: 'insurance_expiry', label: 'Insurance expiry', type: 'date' },
    { name: 'fitness_expiry', label: 'Fitness expiry', type: 'date' },
    { name: 'gps_device_id', label: 'GPS device ID' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'MAINTENANCE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [
    { name: 'vehicle_type', label: 'types', options: statusOptions(['BUS', 'MINI_BUS', 'VAN', 'CAR']) },
    { name: 'status', label: 'status', options: statusOptions(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) },
  ],
};

export const drivers = {
  title: 'Drivers',
  subtitle: 'Driver records, licences and vehicle allocation.',
  endpoint: '/transport/drivers',
  module: 'transport',
  createLabel: 'Add Driver',
  columns: [
    personCol((row) => row.name, (row) => row.phone),
    { key: 'license_number', label: 'Licence', render: (row) => <span className="mono">{row.license_number}</span> },
    dateCol('license_expiry', 'Licence Expiry'),
    { key: 'vehicle_number', label: 'Vehicle', render: (row) => row.vehicle_number || '—' },
    moneyCol('salary', 'Salary'),
    badgeCol(),
  ],
  fields: [
    { name: 'name', label: 'Driver name', required: true },
    { name: 'phone', label: 'Phone', required: true },
    { name: 'license_number', label: 'Licence number', required: true },
    { name: 'license_expiry', label: 'Licence expiry', type: 'date' },
    { name: 'vehicle_id', label: 'Assigned vehicle', type: 'select', options: (l) => opt(l.vehicles, 'vehicle_number') },
    { name: 'date_of_joining', label: 'Date of joining', type: 'date' },
    { name: 'salary', label: 'Monthly salary', type: 'number' },
    { name: 'address', label: 'Address', type: 'textarea', full: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
};

export const routes = {
  title: 'Routes',
  subtitle: 'Transport routes with stops, vehicle, driver and fare.',
  endpoint: '/transport/routes',
  module: 'transport',
  createLabel: 'Add Route',
  columns: [
    { key: 'name', label: 'Route', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub mono">{row.route_code}</div>
      </div>
    ) },
    { key: 'start_point', label: 'From → To', render: (row) => `${row.start_point || '—'} → ${row.end_point || '—'}` },
    { key: 'distance_km', label: 'Distance', numeric: true, render: (row) => row.distance_km ? `${row.distance_km} km` : '—' },
    { key: 'vehicle_number', label: 'Vehicle', render: (row) => row.vehicle_number || '—' },
    { key: 'driver_name', label: 'Driver', render: (row) => row.driver_name || '—' },
    { key: 'student_count', label: 'Students', numeric: true },
    moneyCol('fare', 'Fare'),
    badgeCol(),
  ],
  fields: [
    { name: 'route_code', label: 'Route code', required: true, placeholder: 'R01' },
    { name: 'name', label: 'Route name', required: true },
    { name: 'start_point', label: 'Start point' },
    { name: 'end_point', label: 'End point' },
    { name: 'distance_km', label: 'Distance (km)', type: 'number', step: '0.1' },
    { name: 'vehicle_id', label: 'Vehicle', type: 'select', options: (l) => opt(l.vehicles, 'vehicle_number') },
    { name: 'driver_id', label: 'Driver', type: 'select', options: (l) => opt(l.drivers || [], 'name') },
    { name: 'fare', label: 'Annual fare', type: 'number' },
    { name: 'morning_start', label: 'Morning start', type: 'time' },
    { name: 'evening_start', label: 'Evening start', type: 'time' },
    { name: 'stops', label: 'Stops (comma separated)', type: 'textarea', full: true },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
};

export const transportAllocations = {
  title: 'Student Transport',
  subtitle: 'Which students travel on which route, with pickup and drop points.',
  endpoint: '/transport/allocations',
  module: 'transport',
  createLabel: 'Allocate Transport',
  exportKey: 'transport',
  columns: [
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'route_name', label: 'Route' },
    { key: 'vehicle_number', label: 'Vehicle', render: (row) => row.vehicle_number || '—' },
    { key: 'pickup_point', label: 'Pickup', render: (row) => `${row.pickup_point || '—'} ${row.pickup_time ? `(${row.pickup_time})` : ''}` },
    { key: 'driver_name', label: 'Driver', render: (row) => row.driver_name || '—' },
    moneyCol('fare', 'Fare'),
    badgeCol(),
  ],
  fields: [
    { name: 'student_id', label: 'Student ID', type: 'number', required: true },
    { name: 'route_id', label: 'Route', type: 'select', required: true, options: (l) => opt(l.routes) },
    { name: 'vehicle_id', label: 'Vehicle', type: 'select', options: (l) => opt(l.vehicles, 'vehicle_number') },
    { name: 'pickup_point', label: 'Pickup point' },
    { name: 'drop_point', label: 'Drop point' },
    { name: 'pickup_time', label: 'Pickup time', type: 'time' },
    { name: 'drop_time', label: 'Drop time', type: 'time' },
    { name: 'fare', label: 'Fare', type: 'number' },
    { name: 'academic_year_id', label: 'Academic year', type: 'select', options: (l) => opt(l.academicYears) },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'INACTIVE']), default: 'ACTIVE' },
  ],
  filters: [{ name: 'route_id', label: 'routes', options: (l) => opt(l.routes) }],
};

export const fuelRecords = {
  title: 'Fuel Records',
  subtitle: 'Fuel purchases per vehicle.',
  endpoint: '/transport/fuel',
  module: 'transport',
  createLabel: 'Add Fuel Entry',
  defaultSort: { column: 'fuel_date', order: 'desc' },
  columns: [
    dateCol('fuel_date', 'Date'),
    { key: 'vehicle_number', label: 'Vehicle', render: (row) => <span className="mono">{row.vehicle_number}</span> },
    { key: 'litres', label: 'Litres', numeric: true },
    moneyCol('rate_per_litre', 'Rate'),
    moneyCol('total_cost', 'Total'),
    { key: 'odometer', label: 'Odometer', numeric: true },
    { key: 'bill_number', label: 'Bill', render: (row) => row.bill_number || '—' },
  ],
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'select', required: true, options: (l) => opt(l.vehicles, 'vehicle_number') },
    { name: 'fuel_date', label: 'Date', type: 'date' },
    { name: 'litres', label: 'Litres', type: 'number', required: true, step: '0.01' },
    { name: 'rate_per_litre', label: 'Rate per litre', type: 'number', required: true, step: '0.01' },
    { name: 'total_cost', label: 'Total cost', type: 'number', required: true, step: '0.01' },
    { name: 'odometer', label: 'Odometer reading', type: 'number' },
    { name: 'bill_number', label: 'Bill number' },
  ],
  filters: [{ name: 'vehicle_id', label: 'vehicles', options: (l) => opt(l.vehicles, 'vehicle_number') }],
};

export const vehicleMaintenance = {
  title: 'Vehicle Maintenance',
  subtitle: 'Servicing and repair history.',
  endpoint: '/transport/maintenance',
  module: 'transport',
  createLabel: 'Add Service Record',
  defaultSort: { column: 'service_date', order: 'desc' },
  columns: [
    dateCol('service_date', 'Date'),
    { key: 'vehicle_number', label: 'Vehicle', render: (row) => <span className="mono">{row.vehicle_number}</span> },
    { key: 'service_type', label: 'Service', render: (row) => <span className="cell-primary">{row.service_type}</span> },
    { key: 'garage', label: 'Garage', render: (row) => row.garage || '—' },
    moneyCol('cost', 'Cost'),
    dateCol('next_service_date', 'Next Due'),
  ],
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'select', required: true, options: (l) => opt(l.vehicles, 'vehicle_number') },
    { name: 'service_date', label: 'Service date', type: 'date' },
    { name: 'service_type', label: 'Service type', required: true },
    { name: 'cost', label: 'Cost', type: 'number', step: '0.01' },
    { name: 'garage', label: 'Garage' },
    { name: 'next_service_date', label: 'Next service date', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
  filters: [{ name: 'vehicle_id', label: 'vehicles', options: (l) => opt(l.vehicles, 'vehicle_number') }],
};

/* ================================================================
   LIBRARY
   ================================================================ */
export const books = {
  title: 'Books',
  subtitle: 'The library catalogue with live availability.',
  endpoint: '/library/books',
  module: 'library',
  createLabel: 'Add Book',
  columns: [
    { key: 'title', label: 'Title', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub">{row.author}</div>
      </div>
    ) },
    { key: 'isbn', label: 'ISBN', render: (row) => <span className="mono">{row.isbn || '—'}</span> },
    { key: 'category', label: 'Category', render: (row) => <Badge tone="neutral" dot={false}>{row.category || 'General'}</Badge> },
    { key: 'rack_number', label: 'Rack', render: (row) => row.rack_number || '—' },
    { key: 'available_copies', label: 'Available', numeric: true, render: (row) => (
      <strong className={row.available_copies > 0 ? 'text-success' : 'text-danger'}>
        {row.available_copies} / {row.total_copies}
      </strong>
    ) },
    badgeCol(),
  ],
  fields: [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'author', label: 'Author' },
    { name: 'isbn', label: 'ISBN' },
    { name: 'publisher', label: 'Publisher' },
    { name: 'category', label: 'Category' },
    { name: 'edition', label: 'Edition' },
    { name: 'language', label: 'Language', default: 'English' },
    { name: 'rack_number', label: 'Rack number' },
    { name: 'total_copies', label: 'Total copies', type: 'number', default: 1 },
    { name: 'available_copies', label: 'Available copies', type: 'number' },
    { name: 'price', label: 'Price', type: 'number', step: '0.01' },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'LOST', 'DAMAGED', 'ARCHIVED']), default: 'ACTIVE' },
  ],
  filters: [{ name: 'status', label: 'status', options: statusOptions(['ACTIVE', 'LOST', 'DAMAGED', 'ARCHIVED']) }],
};

export const bookTransactions = {
  title: 'Issue & Return',
  subtitle: 'Circulation history with overdue tracking.',
  endpoint: '/library/transactions',
  module: 'library',
  readOnly: true,
  defaultSort: { column: 'issue_date', order: 'desc' },
  columns: [
    { key: 'book_title', label: 'Book', render: (row) => (
      <div>
        <div className="cell-primary">{row.book_title}</div>
        <div className="cell-sub">{row.author}</div>
      </div>
    ) },
    { key: 'member', label: 'Member', render: (row) => row.member_type === 'STUDENT'
      ? <div><div className="cell-primary">{row.first_name} {row.last_name}</div><div className="cell-sub mono">{row.admission_number}</div></div>
      : row.faculty_name || '—' },
    dateCol('issue_date', 'Issued'),
    dateCol('due_date', 'Due'),
    dateCol('return_date', 'Returned'),
    { key: 'status', label: 'Status', badge: true, render: (row) => (
      <Badge status={row.is_overdue && row.status === 'ISSUED' ? 'OVERDUE' : row.status}>
        {row.is_overdue && row.status === 'ISSUED' ? 'OVERDUE' : row.status}
      </Badge>
    ) },
  ],
  filters: [
    { name: 'status', label: 'status', options: statusOptions(['ISSUED', 'RETURNED', 'OVERDUE', 'LOST']) },
    { name: 'member_type', label: 'members', options: statusOptions(['STUDENT', 'FACULTY']) },
  ],
};

export const fines = {
  title: 'Library Fines',
  subtitle: 'Fines raised for late returns and damage.',
  endpoint: '/library/fines',
  module: 'library',
  readOnly: true,
  columns: [
    { key: 'student', label: 'Member', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'book_title', label: 'Book', render: (row) => row.book_title || '—' },
    { key: 'fine_type', label: 'Reason', render: (row) => <Badge tone="neutral" dot={false}>{row.fine_type}</Badge> },
    { key: 'reason', label: 'Detail' },
    moneyCol('amount', 'Amount'),
    { key: 'paid', label: 'Paid', badge: true, render: (row) => (
      <Badge tone={row.paid ? 'success' : 'danger'} dot={false}>{row.paid ? 'Paid' : 'Unpaid'}</Badge>
    ) },
  ],
  filters: [{ name: 'paid', label: 'payment', options: [{ value: '1', label: 'Paid' }, { value: '0', label: 'Unpaid' }] }],
};

/* ================================================================
   INVENTORY
   ================================================================ */
export const inventoryCategories = {
  title: 'Inventory Categories',
  endpoint: '/inventory/categories',
  module: 'inventory',
  createLabel: 'Add Category',
  columns: [
    { key: 'code', label: 'Code', render: (row) => <span className="mono">{row.code}</span> },
    { key: 'name', label: 'Category', sortable: true, render: (row) => <span className="cell-primary">{row.name}</span> },
    { key: 'item_count', label: 'Items', numeric: true },
    { key: 'description', label: 'Description', render: (row) => row.description || '—' },
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Category name', required: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
};

export const inventoryItems = {
  title: 'Inventory Items',
  subtitle: 'Stationery, IT equipment, furniture, lab and sports material.',
  endpoint: '/inventory/items',
  module: 'inventory',
  createLabel: 'Add Item',
  exportKey: 'inventory',
  columns: [
    { key: 'item_code', label: 'Code', render: (row) => <span className="mono">{row.item_code}</span> },
    { key: 'name', label: 'Item', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub">{row.category_name}</div>
      </div>
    ) },
    { key: 'quantity', label: 'Qty', numeric: true, sortable: true, render: (row) => (
      <strong className={row.needs_reorder ? 'text-danger' : ''}>{row.quantity} {row.unit}</strong>
    ) },
    { key: 'location', label: 'Location', render: (row) => row.location || '—' },
    { key: 'condition_status', label: 'Condition', render: (row) => <Badge tone="neutral" dot={false}>{row.condition_status}</Badge> },
    moneyCol('unit_cost', 'Unit Cost'),
    moneyCol('total_value', 'Value'),
    badgeCol(),
  ],
  fields: [
    { name: 'item_code', label: 'Item code', required: true },
    { name: 'name', label: 'Item name', required: true },
    { name: 'category_id', label: 'Category', type: 'select', required: true, options: (l) => opt(l.inventoryCategories) },
    { name: 'quantity', label: 'Quantity', type: 'number', default: 0 },
    { name: 'unit', label: 'Unit', default: 'PCS' },
    { name: 'reorder_level', label: 'Reorder level', type: 'number', default: 0 },
    { name: 'location', label: 'Location' },
    { name: 'condition_status', label: 'Condition', type: 'select', options: statusOptions(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']), default: 'GOOD' },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'vendor', label: 'Vendor' },
    { name: 'unit_cost', label: 'Unit cost', type: 'number', step: '0.01' },
    { name: 'department_id', label: 'Department', type: 'select', options: (l) => opt(l.departments) },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ACTIVE', 'CONSUMED', 'DISPOSED']), default: 'ACTIVE' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
  filters: [{ name: 'category_id', label: 'categories', options: (l) => opt(l.inventoryCategories) }],
};

export const purchases = {
  title: 'Purchases',
  subtitle: 'Purchase orders and received goods.',
  endpoint: '/inventory/purchases',
  module: 'inventory',
  createLabel: 'Add Purchase',
  defaultSort: { column: 'purchase_date', order: 'desc' },
  columns: [
    { key: 'purchase_order', label: 'PO', render: (row) => <span className="mono">{row.purchase_order || '—'}</span> },
    { key: 'item_name', label: 'Item', sortable: true, render: (row) => <span className="cell-primary">{row.item_name}</span> },
    { key: 'vendor', label: 'Vendor', render: (row) => row.vendor || '—' },
    { key: 'quantity', label: 'Qty', numeric: true },
    moneyCol('unit_cost', 'Unit Cost'),
    moneyCol('total_cost', 'Total'),
    dateCol('purchase_date', 'Date'),
    badgeCol(),
  ],
  fields: [
    { name: 'item_name', label: 'Item name', required: true },
    { name: 'purchase_order', label: 'Purchase order' },
    { name: 'item_id', label: 'Linked inventory item', type: 'select', options: (l) => opt(l.inventoryItems || []) },
    { name: 'vendor', label: 'Vendor' },
    { name: 'quantity', label: 'Quantity', type: 'number', default: 1 },
    { name: 'unit_cost', label: 'Unit cost', type: 'number', step: '0.01' },
    { name: 'total_cost', label: 'Total cost', type: 'number', step: '0.01' },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'invoice_number', label: 'Invoice number' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['ORDERED', 'RECEIVED', 'CANCELLED']), default: 'RECEIVED' },
  ],
};

export const assets = {
  title: 'Assets',
  subtitle: 'Capital assets with value, location and assignment.',
  endpoint: '/inventory/assets',
  module: 'inventory',
  createLabel: 'Add Asset',
  columns: [
    { key: 'asset_code', label: 'Code', render: (row) => <span className="mono">{row.asset_code}</span> },
    { key: 'name', label: 'Asset', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.name}</div>
        <div className="cell-sub">{row.asset_type || '—'}</div>
      </div>
    ) },
    { key: 'location', label: 'Location', render: (row) => row.location || '—' },
    { key: 'department_name', label: 'Department', render: (row) => row.department_name || '—' },
    moneyCol('purchase_cost', 'Purchase Cost'),
    moneyCol('current_value', 'Current Value'),
    badgeCol(),
  ],
  fields: [
    { name: 'asset_code', label: 'Asset code', required: true },
    { name: 'name', label: 'Asset name', required: true },
    { name: 'asset_type', label: 'Type' },
    { name: 'serial_number', label: 'Serial number' },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'purchase_cost', label: 'Purchase cost', type: 'number', step: '0.01' },
    { name: 'current_value', label: 'Current value', type: 'number', step: '0.01' },
    { name: 'vendor', label: 'Vendor' },
    { name: 'location', label: 'Location' },
    { name: 'department_id', label: 'Department', type: 'select', options: (l) => opt(l.departments) },
    { name: 'warranty_expiry', label: 'Warranty expiry', type: 'date' },
    { name: 'condition_status', label: 'Condition', type: 'select', options: statusOptions(['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']), default: 'GOOD' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED']), default: 'IN_USE' },
  ],
  filters: [{ name: 'status', label: 'status', options: statusOptions(['IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED']) }],
};

/* ================================================================
   COMMUNICATION
   ================================================================ */
const TARGET_OPTIONS = statusOptions([
  'ALL', 'STUDENTS', 'PARENTS', 'FACULTY', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'ADMINISTRATORS', 'CLASS', 'SECTION',
]);

const broadcastFields = (dateField, dateLabel) => [
  { name: 'title', label: 'Title', required: true, full: true },
  { name: 'content', label: 'Content', type: 'textarea', rows: 6, required: true, full: true },
  { name: 'target_type', label: 'Audience', type: 'select', options: TARGET_OPTIONS, default: 'ALL' },
  { name: 'target_class_id', label: 'Class', type: 'select', options: (l) => classOpt(l.classes), when: (form) => form.target_type === 'CLASS' },
  { name: 'target_section_id', label: 'Section', type: 'select', options: (l) => sectionOpt(l.sections), when: (form) => form.target_type === 'SECTION' },
  { name: dateField, label: dateLabel, type: 'date' },
];

export const announcements = {
  title: 'Announcements',
  subtitle: 'Publishing an announcement notifies everyone in the selected audience.',
  endpoint: '/communication/announcements',
  module: 'announcements',
  createLabel: 'Create Announcement',
  defaultSort: { column: 'publish_date', order: 'desc' },
  columns: [
    { key: 'title', label: 'Announcement', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub truncate">{row.content}</div>
      </div>
    ) },
    { key: 'priority', label: 'Priority', render: (row) => <Badge status={row.priority}>{row.priority}</Badge> },
    { key: 'target_type', label: 'Audience', render: (row) => (
      <Badge tone="neutral" dot={false}>
        {row.target_type === 'CLASS' ? row.target_class_name : row.target_type === 'SECTION' ? row.target_section_name : row.target_type.replace(/_/g, ' ')}
      </Badge>
    ) },
    dateCol('publish_date', 'Publish Date'),
    { key: 'is_published', label: 'Status', badge: true, render: (row) => (
      <Badge tone={row.is_published ? 'success' : 'neutral'} dot={false}>{row.is_published ? 'Published' : 'Draft'}</Badge>
    ) },
  ],
  fields: [
    ...broadcastFields('publish_date', 'Publish date'),
    { name: 'priority', label: 'Priority', type: 'select', options: statusOptions(['LOW', 'NORMAL', 'HIGH', 'URGENT']), default: 'NORMAL' },
    { name: 'expiry_date', label: 'Expires on', type: 'date' },
  ],
  filters: [
    { name: 'target_type', label: 'audience', options: TARGET_OPTIONS },
    { name: 'is_published', label: 'status', options: [{ value: '1', label: 'Published' }, { value: '0', label: 'Draft' }] },
  ],
  publishable: true,
};

export const notices = {
  title: 'Notices',
  subtitle: 'Formal notices with numbering.',
  endpoint: '/communication/notices',
  module: 'notices',
  createLabel: 'Create Notice',
  defaultSort: { column: 'notice_date', order: 'desc' },
  columns: [
    { key: 'notice_number', label: 'Number', render: (row) => <span className="mono">{row.notice_number || '—'}</span> },
    { key: 'title', label: 'Notice', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub truncate">{row.content}</div>
      </div>
    ) },
    { key: 'target_type', label: 'Audience', render: (row) => <Badge tone="neutral" dot={false}>{row.target_type.replace(/_/g, ' ')}</Badge> },
    dateCol('notice_date', 'Date'),
    { key: 'is_published', label: 'Status', badge: true, render: (row) => (
      <Badge tone={row.is_published ? 'success' : 'neutral'} dot={false}>{row.is_published ? 'Published' : 'Draft'}</Badge>
    ) },
  ],
  fields: [
    { name: 'notice_number', label: 'Notice number', placeholder: 'VGN/2026/N-001' },
    ...broadcastFields('notice_date', 'Notice date'),
    { name: 'expiry_date', label: 'Expires on', type: 'date' },
  ],
  filters: [{ name: 'is_published', label: 'status', options: [{ value: '1', label: 'Published' }, { value: '0', label: 'Draft' }] }],
  publishable: true,
};

export const circulars = {
  title: 'Circulars',
  subtitle: 'Internal circulars issued to staff and students.',
  endpoint: '/communication/circulars',
  module: 'circulars',
  createLabel: 'Create Circular',
  defaultSort: { column: 'issue_date', order: 'desc' },
  columns: [
    { key: 'circular_number', label: 'Number', render: (row) => <span className="mono">{row.circular_number || '—'}</span> },
    { key: 'title', label: 'Circular', sortable: true, render: (row) => <span className="cell-primary">{row.title}</span> },
    { key: 'target_type', label: 'Audience', render: (row) => <Badge tone="neutral" dot={false}>{row.target_type.replace(/_/g, ' ')}</Badge> },
    dateCol('issue_date', 'Issued'),
    { key: 'is_published', label: 'Status', badge: true, render: (row) => (
      <Badge tone={row.is_published ? 'success' : 'neutral'} dot={false}>{row.is_published ? 'Published' : 'Draft'}</Badge>
    ) },
  ],
  fields: [
    { name: 'circular_number', label: 'Circular number' },
    ...broadcastFields('issue_date', 'Issue date'),
  ],
  publishable: true,
};

export const events = {
  title: 'Events & Calendar',
  subtitle: 'Events, holidays and meetings shown on the academic calendar.',
  endpoint: '/communication/events',
  module: 'events',
  createLabel: 'Create Event',
  defaultSort: { column: 'start_date', order: 'desc' },
  columns: [
    { key: 'title', label: 'Event', sortable: true, render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub truncate">{row.description}</div>
      </div>
    ) },
    { key: 'event_type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.event_type}</Badge> },
    dateCol('start_date', 'Date'),
    { key: 'venue', label: 'Venue', render: (row) => row.venue || '—' },
    { key: 'is_published', label: 'Status', badge: true, render: (row) => (
      <Badge tone={row.is_published ? 'success' : 'neutral'} dot={false}>{row.is_published ? 'Published' : 'Draft'}</Badge>
    ) },
  ],
  fields: [
    { name: 'title', label: 'Event title', required: true, full: true },
    { name: 'event_type', label: 'Type', type: 'select', options: statusOptions(['EVENT', 'HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'PTM']), default: 'EVENT' },
    { name: 'start_date', label: 'Start date', type: 'date', required: true },
    { name: 'end_date', label: 'End date', type: 'date' },
    { name: 'start_time', label: 'Start time', type: 'time' },
    { name: 'end_time', label: 'End time', type: 'time' },
    { name: 'venue', label: 'Venue' },
    { name: 'target_type', label: 'Audience', type: 'select', options: TARGET_OPTIONS, default: 'ALL' },
    { name: 'is_published', label: 'Publish', type: 'checkbox', checkboxLabel: 'Publish this event', default: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
  filters: [{ name: 'event_type', label: 'types', options: statusOptions(['EVENT', 'HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'PTM']) }],
};

export const mentoring = {
  title: 'Mentoring Records',
  subtitle: 'Guidance, meetings, remarks and concerns recorded by mentors.',
  endpoint: '/mentoring',
  module: 'mentoring',
  createLabel: 'Add Record',
  defaultSort: { column: 'created_at', order: 'desc' },
  columns: [
    { key: 'student', label: 'Student', render: (row) => (
      <div>
        <div className="cell-primary">{row.first_name} {row.last_name}</div>
        <div className="cell-sub mono">{row.admission_number}</div>
      </div>
    ) },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'record_type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.record_type}</Badge> },
    { key: 'title', label: 'Record', render: (row) => (
      <div>
        <div className="cell-primary">{row.title}</div>
        <div className="cell-sub truncate">{row.notes}</div>
      </div>
    ) },
    { key: 'mentor_name', label: 'Mentor' },
    dateCol('meeting_date', 'Meeting'),
  ],
  fields: [
    { name: 'student_id', label: 'Student ID', type: 'number', required: true },
    { name: 'mentor_id', label: 'Mentor', type: 'select', options: (l) => opt(l.mentors, 'full_name'), hint: 'Teachers may only record for their own mentees' },
    { name: 'record_type', label: 'Type', type: 'select', options: statusOptions(['GUIDANCE', 'REMARK', 'MEETING', 'ACHIEVEMENT', 'CONCERN']), default: 'GUIDANCE' },
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 4, full: true },
    { name: 'meeting_date', label: 'Meeting date', type: 'date' },
    { name: 'follow_up_date', label: 'Follow-up date', type: 'date' },
    { name: 'action_items', label: 'Action items', full: true },
    { name: 'visible_to_parent', label: 'Parent visibility', type: 'checkbox', checkboxLabel: 'Visible to the parent', default: true },
  ],
  filters: [{ name: 'record_type', label: 'types', options: statusOptions(['GUIDANCE', 'REMARK', 'MEETING', 'ACHIEVEMENT', 'CONCERN']) }],
};

export const documents = {
  title: 'Documents',
  subtitle: 'Uploaded student and staff documents.',
  endpoint: '/system/documents',
  module: 'documents',
  readOnly: true,
  defaultSort: { column: 'created_at', order: 'desc' },
  columns: [
    { key: 'title', label: 'Document', sortable: true, render: (row) => (
      <div className="row" style={{ gap: 10 }}>
        <span className="doc-icon tone-navy"><Icon name="file-text" size={16} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="cell-primary truncate">{row.title}</div>
          <div className="cell-sub">{row.document_type || 'General'} · {fileSize(row.file_size)}</div>
        </div>
      </div>
    ) },
    { key: 'owner_type', label: 'Owner', render: (row) => <Badge tone="neutral" dot={false}>{row.owner_type}</Badge> },
    { key: 'owner_id', label: 'Owner ID', numeric: true },
    { key: 'uploaded_by_name', label: 'Uploaded By', render: (row) => row.uploaded_by_name || '—' },
    { key: 'created_at', label: 'Uploaded', render: (row) => formatDateTime(row.created_at) },
    { key: 'verified', label: 'Verified', badge: true, render: (row) => (
      <Badge tone={row.verified ? 'success' : 'warning'} dot={false}>{row.verified ? 'Verified' : 'Pending'}</Badge>
    ) },
    { key: 'file', label: '', render: (row) => (
      <a href={row.file_path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
        <Icon name="download" size={14} />
      </a>
    ) },
  ],
  filters: [{ name: 'owner_type', label: 'owners', options: statusOptions(['STUDENT', 'FACULTY', 'ADMINISTRATOR', 'PARENT']) }],
};

/* ================================================================
   COURSE MATERIALS & PAYROLL (used by the faculty portals)
   ================================================================ */
export const materialsConfig = {
  title: 'Course Materials',
  subtitle: 'Notes, PDFs, presentations, videos, links and assignments for your courses.',
  endpoint: '/materials',
  module: 'materials',
  createLabel: 'Add Material',
  defaultSort: { column: 'created_at', order: 'desc' },
  columns: [
    {
      key: 'title',
      label: 'Material',
      sortable: true,
      render: (row) => (
        <div className="row" style={{ gap: 10 }}>
          <span className="doc-icon tone-purple">
            <Icon name={row.material_type === 'VIDEO' ? 'video' : row.material_type === 'LINK' ? 'link' : 'file-text'} size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="cell-primary truncate">{row.title}</div>
            <div className="cell-sub truncate">{row.description || row.course_name}</div>
          </div>
        </div>
      ),
    },
    { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || row.course_name },
    { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
    { key: 'material_type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.material_type}</Badge> },
    { key: 'due_date', label: 'Due', render: (row) => (row.due_date ? formatDate(row.due_date) : '—') },
    { key: 'created_at', label: 'Uploaded', sortable: true, render: (row) => formatDate(row.created_at) },
    {
      key: 'is_published',
      label: 'Status',
      badge: true,
      render: (row) => (
        <Badge tone={row.is_published ? 'success' : 'neutral'} dot={false}>
          {row.is_published ? 'Published' : 'Draft'}
        </Badge>
      ),
    },
    {
      key: 'open',
      label: '',
      render: (row) =>
        row.file_path ? (
          <a href={row.file_path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            <Icon name="download" size={14} />
          </a>
        ) : row.external_url ? (
          <a href={row.external_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            <Icon name="external-link" size={14} />
          </a>
        ) : null,
    },
  ],
  fields: [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'course_id', label: 'Course', type: 'select', required: true, options: (l) => opt(l.courses) },
    { name: 'section_id', label: 'Section', type: 'select', options: (l) => sectionOpt(l.sections) },
    {
      name: 'material_type',
      label: 'Type',
      type: 'select',
      options: statusOptions(['NOTES', 'PDF', 'PRESENTATION', 'VIDEO', 'LINK', 'ASSIGNMENT', 'OTHER']),
      default: 'NOTES',
    },
    { name: 'external_url', label: 'External link', placeholder: 'https://...' },
    { name: 'due_date', label: 'Due date', type: 'date', hint: 'Assignments only' },
    { name: 'is_published', label: 'Publish', type: 'checkbox', checkboxLabel: 'Visible to students', default: true },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ],
  filters: [
    { name: 'material_type', label: 'types', options: statusOptions(['NOTES', 'PDF', 'PRESENTATION', 'VIDEO', 'LINK', 'ASSIGNMENT']) },
    { name: 'course_id', label: 'courses', options: (l) => opt(l.courses) },
  ],
};

export const payrollConfig = {
  title: 'Payroll',
  subtitle: 'Monthly payslips for every employee.',
  endpoint: '/finance/payroll',
  module: 'payroll',
  createLabel: 'Add Payroll Entry',
  defaultSort: { column: 'year', order: 'desc' },
  columns: [
    { key: 'payslip_number', label: 'Payslip', render: (row) => <span className="mono">{row.payslip_number || '—'}</span> },
    {
      key: 'full_name',
      label: 'Employee',
      render: (row) => (
        <div>
          <div className="cell-primary">{row.full_name}</div>
          <div className="cell-sub mono">{row.faculty_code || row.role_code}</div>
        </div>
      ),
    },
    { key: 'staff_type', label: 'Category', render: (row) => (row.staff_type ? <Badge status={row.staff_type}>{row.staff_type}</Badge> : '—') },
    { key: 'period', label: 'Period', render: (row) => `${row.month}/${row.year}` },
    moneyCol('gross_salary', 'Gross'),
    moneyCol('total_deductions', 'Deductions'),
    moneyCol('net_salary', 'Net Pay'),
    badgeCol(),
  ],
  fields: [
    { name: 'user_id', label: 'Employee user ID', type: 'number', required: true },
    { name: 'month', label: 'Month', type: 'number', required: true },
    { name: 'year', label: 'Year', type: 'number', required: true },
    { name: 'basic_salary', label: 'Basic salary', type: 'number', step: '0.01' },
    { name: 'total_allowances', label: 'Allowances', type: 'number', step: '0.01' },
    { name: 'total_deductions', label: 'Deductions', type: 'number', step: '0.01' },
    { name: 'gross_salary', label: 'Gross salary', type: 'number', step: '0.01' },
    { name: 'net_salary', label: 'Net salary', type: 'number', step: '0.01' },
    { name: 'status', label: 'Status', type: 'select', options: statusOptions(['DRAFT', 'PROCESSED', 'PAID', 'HOLD']), default: 'PROCESSED' },
    { name: 'remarks', label: 'Remarks', full: true },
  ],
  filters: [
    { name: 'status', label: 'status', options: statusOptions(['DRAFT', 'PROCESSED', 'PAID', 'HOLD']) },
    { name: 'year', label: 'year', options: [2024, 2025, 2026, 2027].map((y) => ({ value: String(y), label: String(y) })) },
  ],
  exportKey: 'payroll',
};
