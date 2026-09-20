-- =====================================================================
-- VIGNAN EDUCATIONAL INSTITUTIONS — SCHOOL ERP
-- Relational schema (SQLite dialect, portable to MySQL / PostgreSQL)
-- Multi-campus ready: institutional records carry campus_id so that
-- additional Vignan schools can be onboarded without a redesign.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- TENANCY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campuses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  pincode      TEXT,
  phone        TEXT,
  email        TEXT,
  principal    TEXT,
  logo         TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- IDENTITY, ROLES & PERMISSIONS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  level        INTEGER NOT NULL DEFAULT 50,
  is_system    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  module       TEXT NOT NULL,
  action       TEXT NOT NULL,
  description  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id            INTEGER REFERENCES campuses(id) ON DELETE SET NULL,
  role_id              INTEGER NOT NULL REFERENCES roles(id),
  username             TEXT NOT NULL UNIQUE,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  photo                TEXT,
  gender               TEXT CHECK (gender IN ('MALE','FEMALE','OTHER')),
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_campus ON users(campus_id);

-- Per-user overrides: ALLOW adds a permission, DENY removes it for that user.
CREATE TABLE IF NOT EXISTS user_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        TEXT NOT NULL DEFAULT 'ALLOW' CHECK (effect IN ('ALLOW','DENY')),
  granted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip_address   TEXT,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------
-- ORGANISATION & PEOPLE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id       INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  head_faculty_id INTEGER,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, code)
);

CREATE TABLE IF NOT EXISTS administrators (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus_id         INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  employee_code     TEXT NOT NULL UNIQUE,
  designation       TEXT,
  -- The department (examination board) this administrator may work in. 'BOTH'
  -- is unrestricted; STATE or CBSE narrows every list, report and record they
  -- can reach. Only an Admin may change it.
  board             TEXT NOT NULL DEFAULT 'BOTH' CHECK (board IN ('STATE','CBSE','BOTH')),
  department_id     INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  date_of_joining   TEXT,
  qualification     TEXT,
  address           TEXT,
  emergency_contact TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Faculty covers BOTH categories, discriminated by staff_type.
CREATE TABLE IF NOT EXISTS faculty (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus_id         INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  faculty_code      TEXT NOT NULL UNIQUE,
  staff_type        TEXT NOT NULL CHECK (staff_type IN ('TEACHING','FINANCIAL')),
  board             TEXT NOT NULL DEFAULT 'BOTH' CHECK (board IN ('STATE','CBSE','BOTH')),
  department_id     INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  designation       TEXT,
  qualification     TEXT,
  specialization    TEXT,
  experience_years  REAL DEFAULT 0,
  date_of_birth     TEXT,
  date_of_joining   TEXT,
  blood_group       TEXT,
  address           TEXT,
  emergency_contact TEXT,
  bank_account      TEXT,
  pan_number        TEXT,
  is_mentor         INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ON_LEAVE','RESIGNED')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_faculty_type ON faculty(staff_type);

-- ---------------------------------------------------------------------
-- ACADEMIC STRUCTURE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_years (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  is_current   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED','UPCOMING')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, name)
);

CREATE TABLE IF NOT EXISTS classes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  numeric_level    INTEGER,
  stream           TEXT,
  -- The school runs two departments (examination boards) side by side.
  board            TEXT NOT NULL DEFAULT 'STATE' CHECK (board IN ('STATE','CBSE')),
  class_teacher_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, academic_year_id, name, board)
);

CREATE TABLE IF NOT EXISTS sections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id          INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  class_id           INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  capacity           INTEGER NOT NULL DEFAULT 40,
  room_number        TEXT,
  section_teacher_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  type          TEXT NOT NULL DEFAULT 'CORE' CHECK (type IN ('CORE','ELECTIVE','LANGUAGE','LAB','ACTIVITY')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, code)
);

CREATE TABLE IF NOT EXISTS courses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  subject_id       INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  credits          REAL NOT NULL DEFAULT 4,
  max_marks        REAL NOT NULL DEFAULT 100,
  pass_marks       REAL NOT NULL DEFAULT 35,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, academic_year_id, code)
);

-- The authorisation backbone for teachers: a teacher may only touch
-- courses / sections that appear here for their faculty_id.
CREATE TABLE IF NOT EXISTS course_assignments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  faculty_id       INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  section_id       INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  is_primary       INTEGER NOT NULL DEFAULT 1,
  assigned_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (course_id, faculty_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_ca_faculty ON course_assignments(faculty_id);

-- ---------------------------------------------------------------------
-- STUDENTS & PARENTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  admission_number TEXT NOT NULL UNIQUE,
  roll_number      TEXT,
  first_name       TEXT NOT NULL,
  last_name        TEXT,
  date_of_birth    TEXT,
  gender           TEXT CHECK (gender IN ('MALE','FEMALE','OTHER')),
  blood_group      TEXT,
  photo            TEXT,
  class_id         INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  section_id       INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  board            TEXT NOT NULL DEFAULT 'STATE' CHECK (board IN ('STATE','CBSE')),
  mentor_id        INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  pincode          TEXT,
  nationality      TEXT DEFAULT 'Indian',
  religion         TEXT,
  category         TEXT,
  aadhaar_number   TEXT,
  previous_school  TEXT,
  admission_date   TEXT,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ALUMNI','TRANSFERRED','SUSPENDED')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_class  ON students(class_id, section_id);
CREATE INDEX IF NOT EXISTS idx_students_board  ON students(board);
CREATE INDEX IF NOT EXISTS idx_students_campus ON students(campus_id);

CREATE TABLE IF NOT EXISTS parents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  campus_id         INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  parent_code       TEXT NOT NULL UNIQUE,
  father_name       TEXT,
  father_occupation TEXT,
  father_phone      TEXT,
  mother_name       TEXT,
  mother_occupation TEXT,
  mother_phone      TEXT,
  guardian_name     TEXT,
  relation          TEXT DEFAULT 'FATHER',
  email             TEXT,
  phone             TEXT,
  address           TEXT,
  annual_income     REAL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One parent account -> many children. This table is the guard used by
-- every parent-scoped query.
CREATE TABLE IF NOT EXISTS student_parents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id  INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL DEFAULT 'FATHER',
  is_primary INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, parent_id)
);
CREATE INDEX IF NOT EXISTS idx_sp_parent ON student_parents(parent_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id       INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  roll_number      TEXT,
  enrollment_date  TEXT NOT NULL DEFAULT (date('now')),
  promoted_from    INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','WITHDRAWN')),
  remarks          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, academic_year_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('STUDENT','FACULTY','ADMINISTRATOR','PARENT')),
  owner_id      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  document_type TEXT,
  file_path     TEXT NOT NULL,
  file_name     TEXT,
  file_size     INTEGER,
  mime_type     TEXT,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_type, owner_id);

-- ---------------------------------------------------------------------
-- ATTENDANCE & LEAVE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id        INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  section_id       INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  attendance_date  TEXT NOT NULL,
  period           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT')),
  remarks          TEXT,
  marked_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, attendance_date, course_id, period)
);
CREATE INDEX IF NOT EXISTS idx_att_date    ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_att_student ON attendance(student_id);

CREATE TABLE IF NOT EXISTS faculty_attendance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id       INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  faculty_id      INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE','LEAVE','HALF_DAY')),
  check_in        TEXT,
  check_out       TEXT,
  remarks         TEXT,
  marked_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (faculty_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('STUDENT','FACULTY')),
  student_id     INTEGER REFERENCES students(id) ON DELETE CASCADE,
  faculty_id     INTEGER REFERENCES faculty(id) ON DELETE CASCADE,
  raised_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  leave_type     TEXT NOT NULL DEFAULT 'CASUAL',
  from_date      TEXT NOT NULL,
  to_date        TEXT NOT NULL,
  days           REAL,
  reason         TEXT NOT NULL,
  attachment     TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    TEXT,
  review_remarks TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- EXAMINATIONS, MARKS & RESULTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS examinations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  exam_type        TEXT NOT NULL DEFAULT 'TERM' CHECK (exam_type IN ('UNIT_TEST','TERM','MID_TERM','FINAL','PRACTICAL','ASSIGNMENT')),
  start_date       TEXT,
  end_date         TEXT,
  description      TEXT,
  weightage        REAL DEFAULT 100,
  status           TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('DRAFT','SCHEDULED','ONGOING','COMPLETED','RESULTS_PUBLISHED')),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_subjects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  examination_id INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  class_id       INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  exam_date      TEXT,
  start_time     TEXT,
  end_time       TEXT,
  room           TEXT,
  max_marks      REAL NOT NULL DEFAULT 100,
  pass_marks     REAL NOT NULL DEFAULT 35,
  invigilator_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (examination_id, course_id)
);

CREATE TABLE IF NOT EXISTS grades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id   INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT,
  min_percent REAL NOT NULL,
  max_percent REAL NOT NULL,
  grade_point REAL,
  remarks     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, code)
);

-- Marks carry the teacher -> administrator approval workflow.
CREATE TABLE IF NOT EXISTS marks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  examination_id   INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  exam_subject_id  INTEGER NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  marks_obtained   REAL,
  max_marks        REAL NOT NULL DEFAULT 100,
  grade            TEXT,
  is_absent        INTEGER NOT NULL DEFAULT 0,
  remarks          TEXT,
  status           TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  entered_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TEXT,
  approved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TEXT,
  rejection_reason TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_subject_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_status  ON marks(status);

CREATE TABLE IF NOT EXISTS results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id          INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  examination_id     INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  student_id         INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id           INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  section_id         INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  total_marks        REAL,
  obtained_marks     REAL,
  percentage         REAL,
  grade              TEXT,
  rank_in_class      INTEGER,
  attendance_percent REAL,
  result_status      TEXT CHECK (result_status IN ('PASS','FAIL','PENDING')),
  remarks            TEXT,
  published          INTEGER NOT NULL DEFAULT 0,
  published_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (examination_id, student_id)
);

CREATE TABLE IF NOT EXISTS timetables (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  class_id         INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id       INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  course_id        INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  faculty_id       INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
  day_of_week      INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period           INTEGER NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  room             TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (section_id, day_of_week, period, academic_year_id)
);
CREATE INDEX IF NOT EXISTS idx_tt_faculty ON timetables(faculty_id);

CREATE TABLE IF NOT EXISTS course_materials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id    INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  faculty_id    INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  material_type TEXT NOT NULL DEFAULT 'NOTES' CHECK (material_type IN ('NOTES','PDF','PRESENTATION','VIDEO','LINK','ASSIGNMENT','OTHER')),
  file_path     TEXT,
  file_name     TEXT,
  file_size     INTEGER,
  external_url  TEXT,
  due_date      TEXT,
  is_published  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_course ON course_materials(course_id);

CREATE TABLE IF NOT EXISTS mentoring_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id         INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  mentor_id         INTEGER NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  record_type       TEXT NOT NULL DEFAULT 'GUIDANCE' CHECK (record_type IN ('GUIDANCE','REMARK','MEETING','ACHIEVEMENT','CONCERN')),
  title             TEXT NOT NULL,
  notes             TEXT,
  meeting_date      TEXT,
  action_items      TEXT,
  follow_up_date    TEXT,
  visible_to_parent INTEGER NOT NULL DEFAULT 1,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mentor_student ON mentoring_records(student_id);

-- ---------------------------------------------------------------------
-- FEES & FINANCE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id   INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  frequency   TEXT DEFAULT 'ANNUAL' CHECK (frequency IN ('ANNUAL','TERM','MONTHLY','ONE_TIME')),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, code)
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id        INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  class_id         INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  fee_category_id  INTEGER NOT NULL REFERENCES fee_categories(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  amount           REAL NOT NULL,
  due_date         TEXT,
  late_fee_per_day REAL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_fees (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id         INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_structure_id  INTEGER NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  total_amount      REAL NOT NULL,
  discount_amount   REAL NOT NULL DEFAULT 0,
  concession_reason TEXT,
  paid_amount       REAL NOT NULL DEFAULT 0,
  due_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIAL','PAID','OVERDUE','WAIVED')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, fee_structure_id)
);
CREATE INDEX IF NOT EXISTS idx_sf_student ON student_fees(student_id);

CREATE TABLE IF NOT EXISTS fee_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_fee_id INTEGER NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount         REAL NOT NULL,
  payment_date   TEXT NOT NULL DEFAULT (date('now')),
  payment_mode   TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_mode IN ('CASH','CHEQUE','ONLINE','UPI','CARD','NEFT','DD')),
  transaction_ref TEXT,
  bank_name      TEXT,
  remarks        TEXT,
  status         TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','PENDING','FAILED','REFUNDED')),
  collected_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fp_date ON fee_payments(payment_date);

CREATE TABLE IF NOT EXISTS fee_receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  fee_payment_id INTEGER NOT NULL REFERENCES fee_payments(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL UNIQUE,
  amount         REAL NOT NULL,
  amount_in_words TEXT,
  issued_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at      TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS income (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  amount        REAL NOT NULL,
  income_date   TEXT NOT NULL DEFAULT (date('now')),
  payment_mode  TEXT DEFAULT 'CASH',
  reference     TEXT,
  description   TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  amount        REAL NOT NULL,
  expense_date  TEXT NOT NULL DEFAULT (date('now')),
  payment_mode  TEXT DEFAULT 'CASH',
  vendor        TEXT,
  bill_number   TEXT,
  attachment    TEXT,
  description   TEXT,
  approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS petty_cash (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  entry_date   TEXT NOT NULL DEFAULT (date('now')),
  entry_type   TEXT NOT NULL CHECK (entry_type IN ('IN','OUT')),
  amount       REAL NOT NULL,
  purpose      TEXT NOT NULL,
  balance_after REAL,
  handled_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- PAYROLL
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_structures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  basic_salary  REAL NOT NULL DEFAULT 0,
  hra           REAL NOT NULL DEFAULT 0,
  da            REAL NOT NULL DEFAULT 0,
  conveyance    REAL NOT NULL DEFAULT 0,
  medical       REAL NOT NULL DEFAULT 0,
  other_allowances REAL NOT NULL DEFAULT 0,
  pf_deduction  REAL NOT NULL DEFAULT 0,
  tax_deduction REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL DEFAULT (date('now')),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id       INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month           INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            INTEGER NOT NULL,
  basic_salary    REAL NOT NULL DEFAULT 0,
  total_allowances REAL NOT NULL DEFAULT 0,
  total_deductions REAL NOT NULL DEFAULT 0,
  working_days    INTEGER DEFAULT 0,
  present_days    INTEGER DEFAULT 0,
  lop_days        REAL DEFAULT 0,
  gross_salary    REAL NOT NULL DEFAULT 0,
  net_salary      REAL NOT NULL DEFAULT 0,
  payslip_number  TEXT UNIQUE,
  payment_date    TEXT,
  payment_mode    TEXT DEFAULT 'NEFT',
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PROCESSED','PAID','HOLD')),
  processed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remarks         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, month, year)
);
CREATE INDEX IF NOT EXISTS idx_payroll_user ON payroll(user_id);

-- ---------------------------------------------------------------------
-- TRANSPORT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  vehicle_number TEXT NOT NULL UNIQUE,
  vehicle_type   TEXT NOT NULL DEFAULT 'BUS' CHECK (vehicle_type IN ('BUS','VAN','CAR','MINI_BUS')),
  model          TEXT,
  capacity       INTEGER NOT NULL DEFAULT 40,
  registration_date TEXT,
  insurance_expiry  TEXT,
  fitness_expiry    TEXT,
  gps_device_id  TEXT,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  license_number TEXT NOT NULL,
  license_expiry TEXT,
  address        TEXT,
  photo          TEXT,
  date_of_joining TEXT,
  salary         REAL DEFAULT 0,
  vehicle_id     INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  route_code    TEXT NOT NULL,
  name          TEXT NOT NULL,
  start_point   TEXT,
  end_point     TEXT,
  distance_km   REAL,
  stops         TEXT,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id     INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  fare          REAL DEFAULT 0,
  morning_start TEXT,
  evening_start TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, route_code)
);

CREATE TABLE IF NOT EXISTS transport_allocations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id      INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  pickup_point  TEXT,
  drop_point    TEXT,
  pickup_time   TEXT,
  drop_time     TEXT,
  academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  fare          REAL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ta_student ON transport_allocations(student_id);

CREATE TABLE IF NOT EXISTS fuel_records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fuel_date    TEXT NOT NULL DEFAULT (date('now')),
  litres       REAL NOT NULL,
  rate_per_litre REAL NOT NULL,
  total_cost   REAL NOT NULL,
  odometer     REAL,
  filled_by    TEXT,
  bill_number  TEXT,
  recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date   TEXT NOT NULL DEFAULT (date('now')),
  service_type   TEXT NOT NULL,
  description    TEXT,
  cost           REAL NOT NULL DEFAULT 0,
  garage         TEXT,
  next_service_date TEXT,
  recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS driver_attendance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id       INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  driver_id       INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT','LEAVE')),
  remarks         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (driver_id, attendance_date)
);

-- ---------------------------------------------------------------------
-- LIBRARY
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  isbn          TEXT,
  title         TEXT NOT NULL,
  author        TEXT,
  publisher     TEXT,
  category      TEXT,
  edition       TEXT,
  language      TEXT DEFAULT 'English',
  rack_number   TEXT,
  total_copies  INTEGER NOT NULL DEFAULT 1,
  available_copies INTEGER NOT NULL DEFAULT 1,
  price         REAL DEFAULT 0,
  purchase_date TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LOST','DAMAGED','ARCHIVED')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS book_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  member_type   TEXT NOT NULL DEFAULT 'STUDENT' CHECK (member_type IN ('STUDENT','FACULTY')),
  student_id    INTEGER REFERENCES students(id) ON DELETE CASCADE,
  faculty_id    INTEGER REFERENCES faculty(id) ON DELETE CASCADE,
  issue_date    TEXT NOT NULL DEFAULT (date('now')),
  due_date      TEXT NOT NULL,
  return_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','RETURNED','OVERDUE','LOST')),
  issued_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remarks       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fines (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id           INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  book_transaction_id INTEGER REFERENCES book_transactions(id) ON DELETE CASCADE,
  student_id          INTEGER REFERENCES students(id) ON DELETE CASCADE,
  faculty_id          INTEGER REFERENCES faculty(id) ON DELETE CASCADE,
  fine_type           TEXT NOT NULL DEFAULT 'LATE_RETURN',
  amount              REAL NOT NULL,
  reason              TEXT,
  paid                INTEGER NOT NULL DEFAULT 0,
  paid_date           TEXT,
  collected_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- INVENTORY & ASSETS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id   INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES inventory_categories(id) ON DELETE CASCADE,
  item_code      TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 0,
  unit           TEXT DEFAULT 'PCS',
  reorder_level  INTEGER DEFAULT 0,
  location       TEXT,
  condition_status TEXT DEFAULT 'GOOD' CHECK (condition_status IN ('NEW','GOOD','FAIR','POOR','DAMAGED')),
  purchase_date  TEXT,
  vendor         TEXT,
  unit_cost      REAL DEFAULT 0,
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONSUMED','DISPOSED')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, item_code)
);

CREATE TABLE IF NOT EXISTS purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  purchase_order TEXT,
  item_id        INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name      TEXT NOT NULL,
  vendor         TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_cost      REAL NOT NULL DEFAULT 0,
  total_cost     REAL NOT NULL DEFAULT 0,
  purchase_date  TEXT NOT NULL DEFAULT (date('now')),
  invoice_number TEXT,
  status         TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('ORDERED','RECEIVED','CANCELLED')),
  recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  asset_code     TEXT NOT NULL,
  name           TEXT NOT NULL,
  asset_type     TEXT,
  serial_number  TEXT,
  purchase_date  TEXT,
  purchase_cost  REAL DEFAULT 0,
  current_value  REAL DEFAULT 0,
  vendor         TEXT,
  location       TEXT,
  department_id  INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  condition_status TEXT DEFAULT 'GOOD',
  warranty_expiry TEXT,
  status         TEXT NOT NULL DEFAULT 'IN_USE' CHECK (status IN ('IN_USE','IN_STORE','UNDER_REPAIR','DISPOSED')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, asset_code)
);

-- ---------------------------------------------------------------------
-- COMMUNICATION
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  category      TEXT DEFAULT 'GENERAL',
  priority      TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  target_type   TEXT NOT NULL DEFAULT 'ALL' CHECK (target_type IN ('ALL','STUDENTS','PARENTS','FACULTY','TEACHING_STAFF','FINANCIAL_STAFF','ADMINISTRATORS','CLASS','SECTION')),
  target_class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  target_section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  attachment    TEXT,
  publish_date  TEXT NOT NULL DEFAULT (date('now')),
  expiry_date   TEXT,
  is_published  INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  notice_number TEXT,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  target_type   TEXT NOT NULL DEFAULT 'ALL' CHECK (target_type IN ('ALL','STUDENTS','PARENTS','FACULTY','TEACHING_STAFF','FINANCIAL_STAFF','ADMINISTRATORS','CLASS','SECTION')),
  target_class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  target_section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  attachment    TEXT,
  notice_date   TEXT NOT NULL DEFAULT (date('now')),
  expiry_date   TEXT,
  is_published  INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circulars (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id      INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  circular_number TEXT,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  target_type    TEXT NOT NULL DEFAULT 'ALL' CHECK (target_type IN ('ALL','STUDENTS','PARENTS','FACULTY','TEACHING_STAFF','FINANCIAL_STAFF','ADMINISTRATORS','CLASS','SECTION')),
  target_class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  target_section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  attachment     TEXT,
  issue_date     TEXT NOT NULL DEFAULT (date('now')),
  is_published   INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  attachment    TEXT,
  context_student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  read_at       TEXT,
  sender_deleted    INTEGER NOT NULL DEFAULT 0,
  recipient_deleted INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient_id);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER REFERENCES campuses(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  entity_type  TEXT,
  entity_id    INTEGER,
  is_read      INTEGER NOT NULL DEFAULT 0,
  read_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id     INTEGER NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  event_type    TEXT NOT NULL DEFAULT 'EVENT' CHECK (event_type IN ('EVENT','HOLIDAY','EXAM','MEETING','SPORTS','CULTURAL','PTM')),
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  start_time    TEXT,
  end_time      TEXT,
  venue         TEXT,
  target_type   TEXT NOT NULL DEFAULT 'ALL',
  banner        TEXT,
  is_published  INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- SYSTEM
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER REFERENCES campuses(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT,
  role_code    TEXT,
  action       TEXT NOT NULL,
  module       TEXT,
  entity_type  TEXT,
  entity_id    INTEGER,
  description  TEXT,
  old_values   TEXT,
  new_values   TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  status       TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','FAILED')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_log_user   ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_log_time   ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_log_module ON activity_logs(module);

CREATE TABLE IF NOT EXISTS system_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id    INTEGER REFERENCES campuses(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'GENERAL',
  key          TEXT NOT NULL,
  value        TEXT,
  value_type   TEXT NOT NULL DEFAULT 'STRING' CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','JSON')),
  label        TEXT,
  description  TEXT,
  is_public    INTEGER NOT NULL DEFAULT 0,
  updated_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campus_id, key)
);

-- A person who cannot sign in asks the office to reset their password. There is
-- no mail server here and self-service reset links would be unverifiable, so the
-- request lands in a queue that staff work through after identifying the person
-- at the counter or over the telephone.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  submitted_login TEXT NOT NULL,
  contact         TEXT,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','REJECTED')),
  handled_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at      TEXT,
  handled_note    TEXT,
  ip_address      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reset_status ON password_reset_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reset_user   ON password_reset_requests(user_id);

-- ---------------------------------------------------------------------
-- DEVICE NOTIFICATIONS
-- ---------------------------------------------------------------------
-- One row per browser a person has allowed notifications on — a parent with a
-- phone and a laptop has two. The endpoint is the address the push service
-- gave that browser and is unique to it; the two keys belong to the browser and
-- are what the payload is encrypted for, so the push service itself never sees
-- the contents.
--
-- Subscriptions go stale on their own: a browser reinstalled, permission
-- revoked, an app deleted. The push service reports that as 404 or 410 when we
-- next send, and the row is deleted then rather than lingering.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  last_used_at TEXT,
  failures     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
