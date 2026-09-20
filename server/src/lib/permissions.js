/**
 * Permission catalogue.
 *
 * A permission code is `<module>.<action>`. Modules map to ERP areas, actions
 * are the eight verbs required by the specification:
 *   view | create | edit | delete | approve | publish | export | manage
 *
 * The catalogue is seeded into `permissions` and wired to roles through
 * `role_permissions`. Runtime checks always read the database (so an Admin can
 * change a permission live), but this file defines the shipped defaults.
 */

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'publish', 'export', 'manage'];

export const ROLES = {
  ADMIN: 'ADMIN',
  ADMINISTRATOR: 'ADMINISTRATOR',
  FINANCIAL_STAFF: 'FINANCIAL_STAFF',
  TEACHING_STAFF: 'TEACHING_STAFF',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
};

export const ROLE_DEFINITIONS = [
  {
    code: ROLES.ADMIN,
    name: 'Admin',
    level: 1,
    description: 'Complete control of the ERP software, users, permissions and system configuration.',
  },
  {
    code: ROLES.ADMINISTRATOR,
    name: 'Administrator',
    level: 10,
    description: 'Manages students, faculty and institutional academic operations. Cannot alter software configuration.',
  },
  {
    code: ROLES.FINANCIAL_STAFF,
    name: 'Financial Staff',
    level: 20,
    description: 'Faculty category responsible for fees, accounts, payroll and transport finance.',
  },
  {
    code: ROLES.TEACHING_STAFF,
    name: 'Teaching Staff',
    level: 20,
    description: 'Faculty category responsible for assigned courses, attendance, marks and mentoring.',
  },
  { code: ROLES.STUDENT, name: 'Student', level: 40, description: 'Access to own academic information only.' },
  { code: ROLES.PARENT, name: 'Parent', level: 40, description: 'Monitoring access to own children only.' },
];

/** module -> { label, actions } */
export const MODULES = {
  dashboard: { label: 'Dashboard', actions: ['view'] },
  campuses: { label: 'Campuses', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  users: { label: 'Users', actions: ['view', 'create', 'edit', 'delete', 'manage', 'export'] },
  roles: { label: 'Roles & Permissions', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  // Working the forgotten-password queue. Separate from `users` so the office
  // can reset a pupil's login without gaining control of user accounts at large.
  password_resets: { label: 'Password Resets', actions: ['view', 'manage'] },
  administrators: { label: 'Administrators', actions: ['view', 'create', 'edit', 'delete', 'manage', 'export'] },
  faculty: { label: 'Faculty', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  students: { label: 'Students', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  parents: { label: 'Parents', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  departments: { label: 'Departments', actions: ['view', 'create', 'edit', 'delete'] },
  academics: { label: 'Academics', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  courses: { label: 'Courses', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  enrollments: { label: 'Enrollment & Promotion', actions: ['view', 'create', 'edit', 'delete', 'manage'] },
  timetable: { label: 'Timetable', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  attendance: { label: 'Student Attendance', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  faculty_attendance: { label: 'Faculty Attendance', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  leave: { label: 'Leave Requests', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  examinations: { label: 'Examinations', actions: ['view', 'create', 'edit', 'delete', 'publish', 'manage'] },
  marks: { label: 'Marks', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  results: { label: 'Results', actions: ['view', 'create', 'edit', 'delete', 'publish', 'export'] },
  materials: { label: 'Course Materials', actions: ['view', 'create', 'edit', 'delete'] },
  mentoring: { label: 'Mentoring', actions: ['view', 'create', 'edit', 'delete'] },
  fees: { label: 'Fee Management', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  payments: { label: 'Fee Collection', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  finance: { label: 'Income & Expenses', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export'] },
  payroll: { label: 'Payroll', actions: ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'] },
  transport: { label: 'Transport', actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'] },
  library: { label: 'Library', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  inventory: { label: 'Inventory & Assets', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  announcements: { label: 'Announcements', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  notices: { label: 'Notices', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  circulars: { label: 'Circulars', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  messages: { label: 'Messages', actions: ['view', 'create', 'delete'] },
  events: { label: 'Events & Calendar', actions: ['view', 'create', 'edit', 'delete', 'publish'] },
  documents: { label: 'Documents', actions: ['view', 'create', 'edit', 'delete'] },
  reports: { label: 'Reports', actions: ['view', 'export'] },
  audit: { label: 'Audit Logs', actions: ['view', 'export'] },
  settings: { label: 'System Settings', actions: ['view', 'edit', 'manage'] },
};

/** Every permission code in the system. */
export function allPermissionCodes() {
  const codes = [];
  for (const [module, def] of Object.entries(MODULES)) {
    for (const action of def.actions) codes.push(`${module}.${action}`);
  }
  return codes;
}

/** Expand shorthand entries like `students.*` into concrete codes. */
export function expand(patterns) {
  const out = new Set();
  for (const pattern of patterns) {
    if (pattern === '*') {
      allPermissionCodes().forEach((c) => out.add(c));
      continue;
    }
    const [module, action] = pattern.split('.');
    if (action === '*') {
      (MODULES[module]?.actions || []).forEach((a) => out.add(`${module}.${a}`));
    } else if (MODULES[module]?.actions.includes(action)) {
      out.add(pattern);
    }
  }
  return [...out];
}

/**
 * Default role -> permission matrix.
 *
 * ADMIN gets everything. Every other role is deliberately restricted; note in
 * particular that ADMINISTRATOR has no `settings.*`, `roles.*` or `audit.*`,
 * FINANCIAL_STAFF has no marks/results write access, and TEACHING_STAFF has no
 * global finance access.
 */
export const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: ['*'],

  [ROLES.ADMINISTRATOR]: [
    'dashboard.view',
    'password_resets.*',
    'students.*',
    'parents.*',
    'faculty.view', 'faculty.create', 'faculty.edit', 'faculty.export',
    'administrators.view',
    'departments.*',
    'academics.*',
    'courses.*',
    'enrollments.*',
    'timetable.*',
    'attendance.*',
    'faculty_attendance.*',
    'leave.view', 'leave.create', 'leave.edit', 'leave.approve',
    'examinations.*',
    'marks.view', 'marks.approve', 'marks.export',
    'results.view', 'results.create', 'results.edit', 'results.publish', 'results.export',
    'materials.view',
    'mentoring.*',
    'fees.view', 'fees.export',
    'payments.view',
    'library.*',
    'transport.view', 'transport.create', 'transport.edit',
    'announcements.*',
    'notices.*',
    'circulars.*',
    'messages.*',
    'events.*',
    'documents.*',
    'reports.view', 'reports.export',
  ],

  [ROLES.FINANCIAL_STAFF]: [
    'dashboard.view',
    'fees.*',
    'payments.*',
    'finance.*',
    'payroll.view', 'payroll.create', 'payroll.edit', 'payroll.export',
    'students.view', 'students.export',
    'faculty.view',
    'transport.view', 'transport.create', 'transport.edit', 'transport.export',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'messages.*',
    'announcements.view',
    'notices.view',
    'events.view',
    'leave.view', 'leave.create',
    'reports.view', 'reports.export',
  ],

  [ROLES.TEACHING_STAFF]: [
    'dashboard.view',
    // Scoped by payroll scopeClause() to this employee's own payslips only.
    'payroll.view',
    'courses.view',
    'students.view',
    'materials.*',
    'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.export',
    'marks.view', 'marks.create', 'marks.edit', 'marks.export',
    'results.view',
    'examinations.view',
    'timetable.view',
    'mentoring.view', 'mentoring.create', 'mentoring.edit',
    'leave.view', 'leave.create',
    'messages.*',
    'announcements.view',
    'notices.view',
    'circulars.view',
    'events.view',
    'library.view',
    'reports.view', 'reports.export',
  ],

  [ROLES.STUDENT]: [
    'dashboard.view',
    // students.view is scoped by accessibleStudentIds() to their own record only.
    'students.view',
    'courses.view',
    'materials.view',
    'attendance.view',
    'marks.view',
    'results.view',
    'examinations.view',
    'timetable.view',
    'fees.view',
    'payments.view',
    'mentoring.view',
    'transport.view',
    'library.view',
    'leave.view', 'leave.create',
    'messages.view', 'messages.create',
    'announcements.view',
    'notices.view',
    'circulars.view',
    'events.view',
    'documents.view',
    'reports.view',
  ],

  [ROLES.PARENT]: [
    'dashboard.view',
    'students.view',
    'courses.view',
    'materials.view',
    'attendance.view',
    'results.view',
    'examinations.view',
    'timetable.view',
    'fees.view',
    'payments.view',
    'mentoring.view',
    'transport.view',
    'leave.view', 'leave.create',
    'messages.view', 'messages.create',
    'announcements.view',
    'notices.view',
    'circulars.view',
    'events.view',
    'reports.view',
  ],
};

/** Landing route per role — used by the client after login. */
export const ROLE_HOME = {
  [ROLES.ADMIN]: '/admin/dashboard',
  [ROLES.ADMINISTRATOR]: '/administrator/dashboard',
  [ROLES.FINANCIAL_STAFF]: '/faculty/financial/dashboard',
  [ROLES.TEACHING_STAFF]: '/faculty/teaching/dashboard',
  // Students and parents share one section, so both land in the same place.
  [ROLES.STUDENT]: '/parent/dashboard',
  [ROLES.PARENT]: '/parent/dashboard',
};
