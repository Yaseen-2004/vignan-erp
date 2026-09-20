/**
 * Server-side render smoke test.
 *
 * Every page is rendered once for each role that can reach it, with a stub
 * session and no network. This catches broken imports, undefined components
 * and render-time errors across the whole UI without needing a browser.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { AuthContext } from '../src/context/AuthContext.jsx';
import { ToastProvider } from '../src/context/ToastContext.jsx';

import { Login } from '../src/pages/Login.jsx';
import { AdminDashboard } from '../src/pages/admin/AdminDashboard.jsx';
import { RolesPermissions } from '../src/pages/admin/RolesPermissions.jsx';
import { AuditLogs } from '../src/pages/admin/AuditLogs.jsx';
import { DataImport } from '../src/pages/admin/DataImport.jsx';
import { SystemSettings } from '../src/pages/admin/SystemSettings.jsx';
import { AdministratorDashboard } from '../src/pages/administrator/AdministratorDashboard.jsx';
import { TeachingDashboard } from '../src/pages/faculty/TeachingDashboard.jsx';
import { FinancialDashboard } from '../src/pages/faculty/FinancialDashboard.jsx';
import { MyCourses, MyStudents, MyMentees } from '../src/pages/faculty/TeachingPages.jsx';
import { ParentDashboard } from '../src/pages/parent/ParentDashboard.jsx';
import { ChildSwitcher } from '../src/pages/parent/ChildSwitcher.jsx';
import { Students } from '../src/pages/people/Students.jsx';
import { StudentProfile } from '../src/pages/people/StudentProfile.jsx';
import { StudentAdmission } from '../src/pages/people/StudentAdmission.jsx';
import { Faculty } from '../src/pages/people/Faculty.jsx';
import { FacultyProfile } from '../src/pages/people/FacultyProfile.jsx';
import { Administrators } from '../src/pages/people/Administrators.jsx';
import { Parents } from '../src/pages/people/Parents.jsx';
import { Users } from '../src/pages/people/Users.jsx';
import { MarkAttendance } from '../src/pages/academics/MarkAttendance.jsx';
import { AttendanceOverview } from '../src/pages/academics/AttendanceOverview.jsx';
import { MarksEntry } from '../src/pages/academics/MarksEntry.jsx';
import { MarksApproval } from '../src/pages/academics/MarksApproval.jsx';
import { StudentPromotion } from '../src/pages/academics/StudentPromotion.jsx';
import { FeeCollection } from '../src/pages/finance/FeeCollection.jsx';
import { PendingFees, FinancialAnalysis, FeeReceipts } from '../src/pages/finance/FinancePages.jsx';
import { Notifications } from '../src/pages/shared/Notifications.jsx';
import { Messages } from '../src/pages/shared/Messages.jsx';
import { LeaveRequests } from '../src/pages/shared/LeaveRequests.jsx';
import { MyProfile } from '../src/pages/shared/MyProfile.jsx';
import { ChangePassword } from '../src/pages/shared/ChangePassword.jsx';
import { Payslips } from '../src/pages/shared/Payslips.jsx';
import { Reports } from '../src/pages/shared/Reports.jsx';
import { Receipt } from '../src/pages/shared/Receipt.jsx';
import { ReportCard } from '../src/pages/shared/ReportCard.jsx';
import { NotFound } from '../src/pages/shared/NotFound.jsx';
import { PortalCourses, PortalMaterials, PortalTimetable, PortalCalendar } from '../src/pages/portal/PortalAcademics.jsx';
import { PortalAttendance, PortalResults, PortalFees, PortalMentoring, PortalTransport } from '../src/pages/portal/PortalRecords.jsx';
import { PortalAnnouncements, PortalNotices, PortalCirculars, PortalProfile } from '../src/pages/portal/PortalCommunication.jsx';
import { Resource } from '../src/components/Resource.jsx';
import { ModuleTabs } from '../src/components/ModuleTabs.jsx';
import { AppLayout } from '../src/layouts/AppLayout.jsx';
import * as MODULES from '../src/modules.jsx';
import { NAV } from '../src/nav.js';

const ROLE_PERMISSIONS = {
  ADMIN: null, // `can()` short-circuits to true for ADMIN
  ADMINISTRATOR: ['students.view', 'students.create', 'students.edit', 'students.delete', 'faculty.view', 'academics.view', 'academics.create', 'courses.view', 'courses.manage', 'attendance.view', 'attendance.create', 'examinations.view', 'examinations.create', 'marks.view', 'marks.approve', 'results.view', 'results.publish', 'fees.view', 'announcements.view', 'announcements.create', 'announcements.publish', 'notices.view', 'notices.publish', 'circulars.view', 'messages.view', 'messages.create', 'reports.view', 'reports.export', 'leave.view', 'leave.approve', 'mentoring.view', 'documents.view', 'parents.view', 'enrollments.view', 'enrollments.manage', 'timetable.view', 'departments.view', 'faculty_attendance.view', 'transport.view', 'library.view', 'events.view'],
  TEACHING_STAFF: ['courses.view', 'students.view', 'materials.view', 'materials.create', 'attendance.view', 'attendance.create', 'marks.view', 'marks.create', 'timetable.view', 'mentoring.view', 'mentoring.create', 'reports.view', 'messages.view', 'messages.create', 'leave.view', 'leave.create', 'payroll.view'],
  FINANCIAL_STAFF: ['fees.view', 'fees.create', 'fees.manage', 'payments.view', 'payments.create', 'finance.view', 'finance.create', 'payroll.view', 'students.view', 'faculty.view', 'transport.view', 'transport.create', 'reports.view', 'reports.export', 'messages.view', 'messages.create'],
  STUDENT: ['students.view', 'courses.view', 'materials.view', 'attendance.view', 'results.view', 'fees.view', 'payments.view', 'timetable.view', 'mentoring.view', 'transport.view', 'events.view', 'announcements.view', 'notices.view', 'circulars.view', 'messages.view', 'leave.view', 'leave.create', 'reports.view'],
  PARENT: ['students.view', 'courses.view', 'materials.view', 'attendance.view', 'results.view', 'fees.view', 'payments.view', 'timetable.view', 'mentoring.view', 'transport.view', 'events.view', 'announcements.view', 'notices.view', 'circulars.view', 'messages.view', 'leave.view', 'leave.create', 'reports.view'],
};

const PROFILES = {
  STUDENT: { id: 7, admission_number: 'VGN2025-0007', roll_number: '7', class_name: 'Class 8', section_name: 'A', academic_year: '2025-26', date_of_birth: '2012-05-04', address: 'Guntur' },
  PARENT: { id: 3, parent_code: 'PRN000003', father_name: 'Ravi Kumar', mother_name: 'Sita Kumari', relation: 'FATHER' },
  TEACHING_STAFF: { id: 2, faculty_code: 'VFT0002', staff_type: 'TEACHING', designation: 'Senior Teacher', department_name: 'Mathematics' },
  FINANCIAL_STAFF: { id: 13, faculty_code: 'VFF0001', staff_type: 'FINANCIAL', designation: 'Accounts Manager', department_name: 'Accounts' },
  ADMINISTRATOR: { id: 1, employee_code: 'VADM001', designation: 'Chief Administrative Officer' },
  ADMIN: null,
};

const HOMES = {
  ADMIN: '/admin/dashboard',
  ADMINISTRATOR: '/administrator/dashboard',
  TEACHING_STAFF: '/faculty/teaching/dashboard',
  FINANCIAL_STAFF: '/faculty/financial/dashboard',
  // Pupils and parents share one section, so a pupil lands where a parent does.
  STUDENT: '/parent/dashboard',
  PARENT: '/parent/dashboard',
};

function makeAuth(role) {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  const children =
    role === 'PARENT'
      ? [
          { id: 7, first_name: 'Sneha', last_name: 'Varma', class_id: 8, section_id: 12, class_name: 'Class 8', section_name: 'A', admission_number: 'VGN2025-0007' },
          { id: 21, first_name: 'Charan', last_name: 'Varma', class_id: 5, section_id: 6, class_name: 'Class 5', section_name: 'B', admission_number: 'VGN2025-0021' },
        ]
      : [];

  return {
    user: {
      id: 1,
      username: 'demo',
      email: 'demo@vignan.edu.in',
      fullName: 'Demo User',
      role,
      roleName: role.replace(/_/g, ' '),
      status: 'ACTIVE',
      campusId: 1,
      campusName: 'Vignan Vidyalayam',
      home: HOMES[role],
      permissions: permissions ?? [],
      profile: PROFILES[role],
      lastLoginAt: '2026-08-26 09:00:00',
    },
    loading: false,
    role,
    profile: PROFILES[role],
    children,
    selectedChildId: children[0]?.id ?? null,
    selectedChild: children[0] ?? null,
    selectChild: () => {},
    login: async () => {},
    logout: async () => {},
    refreshUser: async () => {},
    can: (...codes) => (role === 'ADMIN' ? true : codes.flat().some((code) => (permissions ?? []).includes(code))),
  };
}

function render(role, element, route = '/') {
  const auth = makeAuth(role);
  return renderToString(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route] },
      React.createElement(
        ToastProvider,
        null,
        React.createElement(
          AuthContext.Provider,
          { value: auth },
          React.createElement(Routes, null, React.createElement(Route, { path: '*', element }))
        )
      )
    )
  );
}

/** Every screen, paired with the roles that can open it. */
const CASES = [
  ['Login', ['ADMIN'], React.createElement(Login), '/login'],

  ['Admin dashboard', ['ADMIN'], React.createElement(AdminDashboard)],
  ['Roles & permissions', ['ADMIN'], React.createElement(RolesPermissions)],
  ['Audit logs', ['ADMIN'], React.createElement(AuditLogs)],
  ['Import from CSV', ['ADMIN'], React.createElement(DataImport)],
  ['System settings', ['ADMIN'], React.createElement(SystemSettings)],
  ['Users', ['ADMIN'], React.createElement(Users)],
  ['Administrators', ['ADMIN'], React.createElement(Administrators)],

  ['Administrator dashboard', ['ADMINISTRATOR'], React.createElement(AdministratorDashboard)],
  ['Students list', ['ADMIN', 'ADMINISTRATOR'], React.createElement(Students)],
  ['Student admission', ['ADMINISTRATOR'], React.createElement(StudentAdmission)],
  ['Student profile', ['ADMINISTRATOR'], React.createElement(StudentProfile), '/administrator/students/7'],
  ['Faculty list', ['ADMIN', 'ADMINISTRATOR'], React.createElement(Faculty)],
  ['Faculty profile', ['ADMINISTRATOR'], React.createElement(FacultyProfile), '/administrator/faculty/2'],
  ['Parents', ['ADMIN', 'ADMINISTRATOR'], React.createElement(Parents)],
  ['Student promotion', ['ADMINISTRATOR'], React.createElement(StudentPromotion)],
  ['Attendance overview', ['ADMIN', 'ADMINISTRATOR'], React.createElement(AttendanceOverview)],
  ['Marks approval', ['ADMINISTRATOR'], React.createElement(MarksApproval)],

  ['Teaching dashboard', ['TEACHING_STAFF'], React.createElement(TeachingDashboard)],
  ['My courses', ['TEACHING_STAFF'], React.createElement(MyCourses)],
  ['My students', ['TEACHING_STAFF'], React.createElement(MyStudents)],
  ['My mentees', ['TEACHING_STAFF'], React.createElement(MyMentees)],
  ['Mark attendance', ['TEACHING_STAFF'], React.createElement(MarkAttendance)],
  ['Attendance history', ['TEACHING_STAFF'], React.createElement(AttendanceOverview, { historyOnly: true })],
  ['Marks entry', ['TEACHING_STAFF'], React.createElement(MarksEntry)],

  ['Financial dashboard', ['FINANCIAL_STAFF'], React.createElement(FinancialDashboard)],
  ['Fee collection', ['FINANCIAL_STAFF'], React.createElement(FeeCollection)],
  ['Pending fees', ['FINANCIAL_STAFF'], React.createElement(PendingFees)],
  ['Financial analysis', ['FINANCIAL_STAFF'], React.createElement(FinancialAnalysis)],
  ['Fee receipts', ['FINANCIAL_STAFF'], React.createElement(FeeReceipts)],

  ['Parent dashboard', ['PARENT'], React.createElement(ParentDashboard)],
  ['Child switcher', ['PARENT'], React.createElement(ChildSwitcher)],

  ['Portal profile', ['PARENT'], React.createElement(PortalProfile)],
  ['Portal courses', ['PARENT'], React.createElement(PortalCourses)],
  ['Portal materials', ['PARENT'], React.createElement(PortalMaterials)],
  ['Portal assignments', ['PARENT'], React.createElement(PortalMaterials, { assignmentsOnly: true })],
  ['Portal timetable', ['PARENT', 'TEACHING_STAFF'], React.createElement(PortalTimetable)],
  ['Portal calendar', ['PARENT'], React.createElement(PortalCalendar)],
  ['Portal attendance', ['PARENT'], React.createElement(PortalAttendance)],
  ['Portal results', ['PARENT'], React.createElement(PortalResults)],
  ['Portal performance', ['PARENT'], React.createElement(PortalResults, { performanceView: true })],
  ['Portal fees', ['PARENT'], React.createElement(PortalFees)],
  ['Portal mentoring', ['PARENT'], React.createElement(PortalMentoring)],
  ['Portal transport', ['PARENT'], React.createElement(PortalTransport)],
  ['Portal announcements', ['PARENT'], React.createElement(PortalAnnouncements)],
  ['Portal notices', ['PARENT'], React.createElement(PortalNotices)],
  ['Portal circulars', ['PARENT'], React.createElement(PortalCirculars)],

  ['Notifications', ['ADMIN', 'STUDENT', 'PARENT', 'TEACHING_STAFF'], React.createElement(Notifications)],
  ['Messages', ['ADMIN', 'PARENT', 'TEACHING_STAFF'], React.createElement(Messages)],
  ['Leave requests', ['ADMINISTRATOR', 'STUDENT', 'PARENT', 'TEACHING_STAFF'], React.createElement(LeaveRequests)],
  ['My profile', ['ADMIN', 'ADMINISTRATOR', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'STUDENT', 'PARENT'], React.createElement(MyProfile)],
  ['Change password', ['STUDENT'], React.createElement(ChangePassword)],
  ['Payslips', ['TEACHING_STAFF', 'FINANCIAL_STAFF'], React.createElement(Payslips)],
  ['Reports', ['ADMIN', 'ADMINISTRATOR', 'FINANCIAL_STAFF', 'TEACHING_STAFF', 'STUDENT'], React.createElement(Reports)],
  ['Receipt', ['FINANCIAL_STAFF'], React.createElement(Receipt), '/receipts/1'],
  ['Report card', ['STUDENT'], React.createElement(ReportCard), '/report-card/2/7'],
  ['Not found', ['STUDENT'], React.createElement(NotFound)],
];

export function run() {
  const failures = [];
  let passed = 0;

  // renderToString warns about useLayoutEffect in react-router's Link. That is
  // expected off-DOM and says nothing about the components under test.
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => {
    if (String(args[0] ?? '').includes('useLayoutEffect')) return;
    originalError(...args);
  };
  console.warn = (...args) => {
    if (String(args[0] ?? '').includes('useLayoutEffect')) return;
    originalWarn(...args);
  };

  for (const [name, roles, element, route] of CASES) {
    for (const role of roles) {
      try {
        const html = render(role, element, route || '/');
        if (typeof html !== 'string' || html.length === 0) {
          failures.push(`${name} [${role}]: rendered empty output`);
        } else {
          passed += 1;
        }
      } catch (error) {
        failures.push(`${name} [${role}]: ${error.message}`);
      }
    }
  }

  // Every module config must render as a resource page for a permitted role.
  const moduleRoles = {
    academicYears: 'ADMIN', classes: 'ADMIN', sections: 'ADMIN', subjects: 'ADMIN', courses: 'ADMIN',
    courseAssignments: 'ADMIN', departments: 'ADMIN', grades: 'ADMIN', timetable: 'ADMIN', enrollments: 'ADMIN',
    examinations: 'ADMIN', examSchedule: 'ADMIN', results: 'ADMIN', facultyAttendance: 'ADMIN',
    feeCategories: 'ADMIN', feeStructures: 'ADMIN', studentFees: 'ADMIN', feePayments: 'ADMIN',
    income: 'ADMIN', expenses: 'ADMIN', pettyCash: 'ADMIN', salaryStructures: 'ADMIN',
    vehicles: 'ADMIN', drivers: 'ADMIN', routes: 'ADMIN', transportAllocations: 'ADMIN',
    fuelRecords: 'ADMIN', vehicleMaintenance: 'ADMIN', books: 'ADMIN', bookTransactions: 'ADMIN',
    fines: 'ADMIN', inventoryCategories: 'ADMIN', inventoryItems: 'ADMIN', purchases: 'ADMIN', assets: 'ADMIN',
    announcements: 'ADMIN', notices: 'ADMIN', circulars: 'ADMIN', events: 'ADMIN',
    mentoring: 'ADMIN', documents: 'ADMIN', materialsConfig: 'TEACHING_STAFF', payrollConfig: 'ADMIN',
  };

  for (const [key, role] of Object.entries(moduleRoles)) {
    const config = MODULES[key];
    if (!config) {
      failures.push(`module config "${key}" is missing from modules.jsx`);
      continue;
    }
    try {
      const html = render(role, React.createElement(Resource, { config }));
      if (!html) failures.push(`module ${key}: empty render`);
      else passed += 1;
    } catch (error) {
      failures.push(`module ${key} [${role}]: ${error.message}`);
    }
  }

  // Tabbed hubs used by the Admin navigation.
  try {
    render(
      'ADMIN',
      React.createElement(ModuleTabs, {
        title: 'Academics',
        tabs: [
          { key: 'years', label: 'Academic Years', config: MODULES.academicYears },
          { key: 'classes', label: 'Classes', config: MODULES.classes },
        ],
      })
    );
    passed += 1;
  } catch (error) {
    failures.push(`ModuleTabs: ${error.message}`);
  }

  // The app shell for every role (sidebar, topbar, mobile nav).
  for (const role of Object.keys(HOMES)) {
    try {
      const html = render(role, React.createElement(AppLayout), HOMES[role]);
      if (!html.includes('Vignan ERP')) failures.push(`AppLayout [${role}]: brand missing from output`);
      else passed += 1;
    } catch (error) {
      failures.push(`AppLayout [${role}]: ${error.message}`);
    }
  }

  // Navigation integrity: every entry must have a label, path and icon.
  for (const [role, groups] of Object.entries(NAV)) {
    for (const group of groups) {
      for (const item of group.items) {
        if (!item.label || !item.to || !item.icon) {
          failures.push(`NAV ${role}: malformed entry ${JSON.stringify(item)}`);
        }
      }
    }
  }

  console.error = originalError;
  console.warn = originalWarn;

  return { passed, failures };
}
