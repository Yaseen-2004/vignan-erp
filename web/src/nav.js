/**
 * Role navigation.
 *
 * These maps reproduce the four top-level sections of the specification
 * exactly — ADMIN, ADMINISTRATOR, FACULTY (Financial + Teaching) and
 * STUDENTS & PARENTS — including the module names and their grouping.
 *
 * `permission` hides an entry the signed-in user cannot use; the API refuses
 * the same call regardless, so this is presentation only.
 */

export const NAV = {
  // =================================================================
  // 1. ADMIN — complete software control
  // =================================================================
  ADMIN: [
    {
      items: [{ label: 'Dashboard', to: '/admin/dashboard', icon: 'dashboard' }],
    },
    {
      title: 'People',
      items: [
        { label: 'Administrators', to: '/admin/administrators', icon: 'user-cog', permission: 'administrators.view' },
        { label: 'Faculty', to: '/admin/faculty', icon: 'briefcase', permission: 'faculty.view' },
        { label: 'Faculty Assignments', to: '/admin/assignments', icon: 'user-check', permission: 'faculty.view' },
        { label: 'Students', to: '/admin/students', icon: 'graduation-cap', permission: 'students.view' },
        { label: 'Parents', to: '/admin/parents', icon: 'users', permission: 'parents.view' },
        { label: 'Users', to: '/admin/users', icon: 'user', permission: 'users.view' },
        { label: 'Roles & Permissions', to: '/admin/roles', icon: 'shield-check', permission: 'roles.view' },
        { label: 'Password Resets', to: '/admin/password-resets', icon: 'key', permission: 'password_resets.view' },
      ],
    },
    {
      title: 'Academics',
      items: [
        { label: 'Departments', to: '/admin/departments', icon: 'grid', permission: 'academics.view' },
        { label: 'Academics', to: '/admin/academics', icon: 'layers', permission: 'academics.view' },
        { label: 'Attendance', to: '/admin/attendance', icon: 'calendar-check', permission: 'attendance.view' },
        { label: 'Examinations', to: '/admin/examinations', icon: 'clipboard-check', permission: 'examinations.view' },
        { label: 'Results', to: '/admin/results', icon: 'award', permission: 'results.view' },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Fees', to: '/admin/fees', icon: 'wallet', permission: 'fees.view' },
        { label: 'Payroll', to: '/admin/payroll', icon: 'banknote', permission: 'payroll.view' },
        { label: 'Transport', to: '/admin/transport', icon: 'bus', permission: 'transport.view' },
        { label: 'Library', to: '/admin/library', icon: 'library', permission: 'library.view' },
        { label: 'Inventory', to: '/admin/inventory', icon: 'package', permission: 'inventory.view' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { label: 'Announcements', to: '/admin/announcements', icon: 'megaphone', permission: 'announcements.view' },
        { label: 'Notices', to: '/admin/notices', icon: 'file-text', permission: 'notices.view' },
        { label: 'Messages', to: '/messages', icon: 'mail', permission: 'messages.view' },
      ],
    },
    {
      title: 'System',
      items: [
        { label: 'Reports', to: '/admin/reports', icon: 'bar-chart', permission: 'reports.view' },
        { label: 'Audit Logs', to: '/admin/audit-logs', icon: 'history', permission: 'audit.view' },
        { label: 'System Settings', to: '/admin/settings', icon: 'settings', permission: 'settings.view' },
        { label: 'Import from CSV', to: '/admin/import', icon: 'upload', permission: 'students.create' },
        { label: 'Data & Storage', to: '/admin/storage', icon: 'package', permission: 'settings.edit' },
        { label: 'User Manual', to: '/manual', icon: 'book-open' },
      ],
    },
  ],

  // =================================================================
  // 2. ADMINISTRATOR — student & faculty management
  // =================================================================
  ADMINISTRATOR: [
    {
      items: [
        { label: 'Dashboard', to: '/administrator/dashboard', icon: 'dashboard' },
        { label: 'Departments', to: '/administrator/wings', icon: 'grid', permission: 'academics.view' },
      ],
    },
    {
      title: 'Students',
      items: [
        { label: 'Student Admission', to: '/administrator/admission', icon: 'user-plus', permission: 'students.create' },
        { label: 'Student List', to: '/administrator/students', icon: 'graduation-cap', permission: 'students.view' },
        { label: 'Student Enrollment', to: '/administrator/enrollment', icon: 'file-check', permission: 'enrollments.view' },
        { label: 'Student Promotion', to: '/administrator/promotion', icon: 'trending-up', permission: 'enrollments.manage' },
        { label: 'Student Documents', to: '/administrator/documents', icon: 'files', permission: 'documents.view' },
        { label: 'Student Attendance', to: '/administrator/attendance', icon: 'calendar-check', permission: 'attendance.view' },
        { label: 'Student Results', to: '/administrator/results', icon: 'award', permission: 'results.view' },
        { label: 'Student Fees', to: '/administrator/fees', icon: 'wallet', permission: 'fees.view' },
        { label: 'Student Transport', to: '/administrator/transport', icon: 'bus', permission: 'transport.view' },
        { label: 'Student Mentoring', to: '/administrator/mentoring', icon: 'compass', permission: 'mentoring.view' },
        { label: 'Leave Requests', to: '/administrator/leave', icon: 'clipboard', permission: 'leave.view' },
        { label: 'Parents', to: '/administrator/parents', icon: 'users', permission: 'parents.view' },
        { label: 'Password Resets', to: '/administrator/password-resets', icon: 'key', permission: 'password_resets.view' },
      ],
    },
    {
      title: 'Faculty',
      items: [
        { label: 'Faculty List', to: '/administrator/faculty', icon: 'briefcase', permission: 'faculty.view' },
        { label: 'Subject Departments', to: '/administrator/departments', icon: 'building', permission: 'departments.view' },
        { label: 'Faculty Assignments', to: '/administrator/assignments', icon: 'user-check', permission: 'faculty.view' },
        { label: 'Course Assignment', to: '/administrator/course-assignments', icon: 'link', permission: 'courses.view' },
        { label: 'Faculty Attendance', to: '/administrator/faculty-attendance', icon: 'user-check', permission: 'faculty_attendance.view' },
      ],
    },
    {
      title: 'Academics',
      items: [
        { label: 'Academic Year', to: '/administrator/academic-years', icon: 'calendar', permission: 'academics.view' },
        { label: 'Classes', to: '/administrator/classes', icon: 'grid', permission: 'academics.view' },
        { label: 'Sections', to: '/administrator/sections', icon: 'list', permission: 'academics.view' },
        { label: 'Subjects', to: '/administrator/subjects', icon: 'book', permission: 'academics.view' },
        { label: 'Courses', to: '/administrator/courses', icon: 'book-open', permission: 'courses.view' },
        { label: 'Timetable', to: '/administrator/timetable', icon: 'clock', permission: 'timetable.view' },
      ],
    },
    {
      title: 'Examination',
      items: [
        { label: 'Exams', to: '/administrator/examinations', icon: 'clipboard-check', permission: 'examinations.view' },
        { label: 'Examination Schedule', to: '/administrator/exam-schedule', icon: 'calendar', permission: 'examinations.view' },
        { label: 'Marks Approval', to: '/administrator/marks', icon: 'check-circle', permission: 'marks.approve' },
        { label: 'Results', to: '/administrator/exam-results', icon: 'award', permission: 'results.view' },
        { label: 'Grades', to: '/administrator/grades', icon: 'percent', permission: 'examinations.view' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { label: 'Announcements', to: '/administrator/announcements', icon: 'megaphone', permission: 'announcements.view' },
        { label: 'Notices', to: '/administrator/notices', icon: 'file-text', permission: 'notices.view' },
        { label: 'Circulars', to: '/administrator/circulars', icon: 'files', permission: 'circulars.view' },
        { label: 'Messages', to: '/messages', icon: 'mail', permission: 'messages.view' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { label: 'Reports', to: '/administrator/reports', icon: 'bar-chart', permission: 'reports.view' },
        { label: 'User Manual', to: '/manual', icon: 'book-open' },
      ],
    },
  ],

  // =================================================================
  // 3A. FACULTY — FINANCIAL STAFF
  // =================================================================
  FINANCIAL_STAFF: [
    {
      items: [
        { label: 'Dashboard', to: '/faculty/financial/dashboard', icon: 'dashboard' },
        { label: 'My Profile', to: '/profile', icon: 'user' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Fee Management', to: '/faculty/financial/fee-structures', icon: 'sliders', permission: 'fees.view' },
        { label: 'Fee Collection', to: '/faculty/financial/collection', icon: 'credit-card', permission: 'payments.create' },
        { label: 'Pending Fees', to: '/faculty/financial/pending', icon: 'alert-circle', permission: 'fees.view' },
        { label: 'Fee Payments', to: '/faculty/financial/payments', icon: 'banknote', permission: 'payments.view' },
        { label: 'Fee Receipts', to: '/faculty/financial/receipts', icon: 'receipt', permission: 'payments.view' },
        { label: 'Financial Analysis', to: '/faculty/financial/analysis', icon: 'pie-chart', permission: 'finance.view' },
        { label: 'Income', to: '/faculty/financial/income', icon: 'trending-up', permission: 'finance.view' },
        { label: 'Expenses', to: '/faculty/financial/expenses', icon: 'calculator', permission: 'finance.view' },
        { label: 'Petty Cash', to: '/faculty/financial/petty-cash', icon: 'wallet', permission: 'finance.view' },
      ],
    },
    {
      title: 'Student Information',
      items: [
        { label: 'Student List', to: '/faculty/financial/students', icon: 'graduation-cap', permission: 'students.view' },
        { label: 'Student Fee Details', to: '/faculty/financial/student-fees', icon: 'file-text', permission: 'fees.view' },
      ],
    },
    {
      title: 'Faculty Information',
      items: [{ label: 'Faculty List', to: '/faculty/financial/faculty', icon: 'briefcase', permission: 'faculty.view' }],
    },
    {
      title: 'Transportation',
      items: [
        { label: 'Transport Records', to: '/faculty/financial/transport', icon: 'bus', permission: 'transport.view' },
        { label: 'Vehicle Expenses', to: '/faculty/financial/maintenance', icon: 'truck', permission: 'transport.view' },
        { label: 'Fuel Expenses', to: '/faculty/financial/fuel', icon: 'activity', permission: 'transport.view' },
      ],
    },
    {
      title: 'Pay',
      items: [
        { label: 'Payroll', to: '/faculty/financial/payroll', icon: 'banknote', permission: 'payroll.view' },
        { label: 'My Payslips', to: '/payslips', icon: 'receipt' },
      ],
    },
    {
      title: 'More',
      items: [
        { label: 'Reports', to: '/faculty/financial/reports', icon: 'bar-chart', permission: 'reports.view' },
        { label: 'Messages', to: '/messages', icon: 'mail', permission: 'messages.view' },
        { label: 'User Manual', to: '/manual', icon: 'book-open' },
      ],
    },
  ],

  // =================================================================
  // 3B. FACULTY — TEACHING STAFF
  // =================================================================
  TEACHING_STAFF: [
    {
      items: [
        { label: 'Dashboard', to: '/faculty/teaching/dashboard', icon: 'dashboard' },
        { label: 'My Profile', to: '/profile', icon: 'user' },
      ],
    },
    {
      title: 'Assigned Courses',
      items: [
        { label: 'My Courses', to: '/faculty/teaching/courses', icon: 'book-open', permission: 'courses.view' },
        { label: 'My Students', to: '/faculty/teaching/students', icon: 'graduation-cap', permission: 'students.view' },
      ],
    },
    {
      title: 'Course Material',
      items: [{ label: 'Course Materials', to: '/faculty/teaching/materials', icon: 'files', permission: 'materials.view' }],
    },
    {
      title: 'Attendance',
      items: [
        { label: 'Mark Attendance', to: '/faculty/teaching/attendance', icon: 'calendar-check', permission: 'attendance.create' },
        { label: 'Attendance History', to: '/faculty/teaching/attendance-history', icon: 'history', permission: 'attendance.view' },
      ],
    },
    {
      title: 'Marks',
      items: [{ label: 'Enter Marks', to: '/faculty/teaching/marks', icon: 'clipboard-check', permission: 'marks.view' }],
    },
    {
      title: 'Timetable',
      items: [{ label: 'My Timetable', to: '/faculty/teaching/timetable', icon: 'clock', permission: 'timetable.view' }],
    },
    {
      title: 'Mentoring',
      items: [
        { label: 'My Mentees', to: '/faculty/teaching/mentees', icon: 'compass', permission: 'mentoring.view' },
        { label: 'Mentoring Records', to: '/faculty/teaching/mentoring', icon: 'heart', permission: 'mentoring.view' },
      ],
    },
    {
      title: 'More',
      items: [
        { label: 'Reports', to: '/faculty/teaching/reports', icon: 'bar-chart', permission: 'reports.view' },
        { label: 'My Payslips', to: '/payslips', icon: 'receipt' },
        { label: 'Leave', to: '/leave', icon: 'clipboard', permission: 'leave.view' },
        { label: 'Messages', to: '/messages', icon: 'mail', permission: 'messages.view' },
        { label: 'User Manual', to: '/manual', icon: 'book-open' },
      ],
    },
  ],

  // =================================================================
  // 4. STUDENTS & PARENTS
  //
  // One section per family. Everything a pupil needs is here, shown for the
  // child the parent has selected — so a parent of three works from a single
  // menu instead of three sign-ins.
  // =================================================================
  PARENT: [
    {
      items: [
        { label: 'Dashboard', to: '/parent/dashboard', icon: 'dashboard', mobile: true },
        { label: 'Child Profile', to: '/parent/profile', icon: 'graduation-cap', mobile: true },
        { label: 'Courses', to: '/parent/courses', icon: 'book-open' },
        { label: 'Course Materials', to: '/parent/materials', icon: 'files', mobile: true },
        { label: 'Assignments', to: '/parent/assignments', icon: 'clipboard' },
        { label: 'Attendance', to: '/parent/attendance', icon: 'calendar-check', mobile: true },
        { label: 'Academic Performance', to: '/parent/performance', icon: 'trending-up' },
        { label: 'Results', to: '/parent/results', icon: 'award', mobile: true },
        { label: 'Timetable', to: '/parent/timetable', icon: 'clock' },
        { label: 'Fees', to: '/parent/fees', icon: 'wallet' },
        { label: 'Announcements', to: '/parent/announcements', icon: 'megaphone' },
        { label: 'Notices', to: '/parent/notices', icon: 'file-text' },
        { label: 'Circulars', to: '/parent/circulars', icon: 'files' },
        { label: 'Calendar', to: '/parent/calendar', icon: 'calendar' },
        { label: 'Notifications', to: '/notifications', icon: 'bell' },
        { label: 'Leave Requests', to: '/leave', icon: 'clipboard' },
        { label: 'User Manual', to: '/manual', icon: 'book-open' },
        { label: 'Mentoring', to: '/parent/mentoring', icon: 'compass' },
        { label: 'Transportation', to: '/parent/transport', icon: 'bus' },
        { label: 'Messages', to: '/messages', icon: 'mail' },
      ],
    },
  ],
};

/** Human label for each role. */
export const ROLE_LABEL = {
  ADMIN: 'Admin',
  ADMINISTRATOR: 'Administrator',
  FINANCIAL_STAFF: 'Financial Staff',
  TEACHING_STAFF: 'Teaching Staff',
  STUDENT: 'Student',
  PARENT: 'Parent',
};

/** Section heading shown under the brand mark. */
export const ROLE_SECTION = {
  ADMIN: 'System Control',
  ADMINISTRATOR: 'Student & Faculty',
  FINANCIAL_STAFF: 'Faculty · Finance',
  TEACHING_STAFF: 'Faculty · Teaching',
  // Students and parents share one section, so it is named for the family.
  STUDENT: 'Student & Parent',
  PARENT: 'Student & Parent',
};

/** The four or five destinations shown in the phone bottom bar. */
export function mobileNav(role) {
  const groups = NAV[role] || [];
  const flat = groups.flatMap((group) => group.items);
  const flagged = flat.filter((item) => item.mobile);
  if (flagged.length) return flagged.slice(0, 4);
  return flat.slice(0, 4);
}
