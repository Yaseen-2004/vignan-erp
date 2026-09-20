import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AppLayout } from './layouts/AppLayout.jsx';
import { Resource } from './components/Resource.jsx';
import { ModuleTabs } from './components/ModuleTabs.jsx';
import * as M from './modules.jsx';

import { Login } from './pages/Login.jsx';

import { AdminDashboard } from './pages/admin/AdminDashboard.jsx';
import { RolesPermissions } from './pages/admin/RolesPermissions.jsx';
import { PasswordResets } from './pages/admin/PasswordResets.jsx';
import { FacultyAssignments } from './pages/admin/FacultyAssignments.jsx';
import { DataStorage } from './pages/admin/DataStorage.jsx';
import { DataImport } from './pages/admin/DataImport.jsx';
import { AuditLogs } from './pages/admin/AuditLogs.jsx';
import { SystemSettings } from './pages/admin/SystemSettings.jsx';

import { AdministratorDashboard } from './pages/administrator/AdministratorDashboard.jsx';

import { TeachingDashboard } from './pages/faculty/TeachingDashboard.jsx';
import { FinancialDashboard } from './pages/faculty/FinancialDashboard.jsx';
import { MyCourses, MyStudents, MyMentees } from './pages/faculty/TeachingPages.jsx';

import { ParentDashboard } from './pages/parent/ParentDashboard.jsx';

import { Students } from './pages/people/Students.jsx';
import { StudentProfile } from './pages/people/StudentProfile.jsx';
import { StudentAdmission } from './pages/people/StudentAdmission.jsx';
import { Departments } from './pages/academics/Departments.jsx';
import { CourseMaterials } from './pages/faculty/CourseMaterials.jsx';
import { MentoringRecords } from './pages/faculty/MentoringRecords.jsx';
import { Faculty } from './pages/people/Faculty.jsx';
import { FacultyProfile } from './pages/people/FacultyProfile.jsx';
import { Administrators } from './pages/people/Administrators.jsx';
import { Parents } from './pages/people/Parents.jsx';
import { Users } from './pages/people/Users.jsx';

import { MarkAttendance } from './pages/academics/MarkAttendance.jsx';
import { AttendanceOverview } from './pages/academics/AttendanceOverview.jsx';
import { MarksEntry } from './pages/academics/MarksEntry.jsx';
import { MarksApproval } from './pages/academics/MarksApproval.jsx';
import { StudentPromotion } from './pages/academics/StudentPromotion.jsx';

import { FeeCollection } from './pages/finance/FeeCollection.jsx';
import { PendingFees, FinancialAnalysis, FeeReceipts } from './pages/finance/FinancePages.jsx';

import { Notifications } from './pages/shared/Notifications.jsx';
import { Messages } from './pages/shared/Messages.jsx';
import { LeaveRequests } from './pages/shared/LeaveRequests.jsx';
import { MyProfile } from './pages/shared/MyProfile.jsx';
import { ChangePassword } from './pages/shared/ChangePassword.jsx';
import { Manual } from './pages/shared/Manual.jsx';
import { Payslips } from './pages/shared/Payslips.jsx';
import { Reports } from './pages/shared/Reports.jsx';
import { Receipt } from './pages/shared/Receipt.jsx';
import { ReportCard } from './pages/shared/ReportCard.jsx';
import { NotFound } from './pages/shared/NotFound.jsx';

import {
  PortalCourses, PortalMaterials, PortalTimetable, PortalCalendar,
} from './pages/portal/PortalAcademics.jsx';
import {
  PortalAttendance, PortalResults, PortalFees, PortalMentoring, PortalTransport,
} from './pages/portal/PortalRecords.jsx';
import {
  PortalAnnouncements, PortalNotices, PortalCirculars, PortalProfile,
} from './pages/portal/PortalCommunication.jsx';

/* ------------------------------------------------------------- guards */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <span className="spinner" style={{ width: 28, height: 28, color: 'var(--navy-600)' }} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Blocks a role from another role's area; the API refuses it too. */
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to={user.home} replace />;
  return children;
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user.home} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomeRedirect />} />

        {/* ============================================================
            1. ADMIN — complete software control
            ============================================================ */}
        <Route
          path="/admin/*"
          element={
            <RequireRole roles={['ADMIN']}>
              <Routes>
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="departments" element={<Departments basePath="/admin" />} />
                <Route path="administrators" element={<Administrators />} />
                <Route path="faculty" element={<Faculty basePath="/admin" />} />
                <Route path="faculty/:id" element={<FacultyProfile basePath="/admin" />} />
                <Route path="students" element={<Students basePath="/admin" />} />
                <Route path="students/:id" element={<StudentProfile basePath="/admin" />} />
                <Route path="parents" element={<Parents />} />
                <Route path="users" element={<Users />} />
                <Route path="roles" element={<RolesPermissions />} />
                <Route path="password-resets" element={<PasswordResets />} />
                <Route path="assignments" element={<FacultyAssignments />} />

                <Route
                  path="academics"
                  element={
                    <ModuleTabs
                      title="Academics"
                      subtitle="Academic years, classes, sections, subjects, courses, assignments and the timetable."
                      tabs={[
                        { key: 'years', label: 'Academic Years', config: M.academicYears },
                        { key: 'classes', label: 'Classes', config: M.classes },
                        { key: 'sections', label: 'Sections', config: M.sections },
                        { key: 'subjects', label: 'Subjects', config: M.subjects },
                        { key: 'courses', label: 'Courses', config: M.courses },
                        { key: 'assignments', label: 'Course Assignments', config: M.courseAssignments },
                        { key: 'timetable', label: 'Timetable', config: M.timetable },
                        { key: 'departments', label: 'Departments', config: M.departments },
                        { key: 'enrollments', label: 'Enrollments', config: M.enrollments },
                      ]}
                    />
                  }
                />

                <Route path="attendance" element={<AttendanceOverview />} />

                <Route
                  path="examinations"
                  element={
                    <ModuleTabs
                      title="Examinations"
                      subtitle="Examinations, schedules, marks approval and grade bands."
                      tabs={[
                        { key: 'exams', label: 'Examinations', config: M.examinations },
                        { key: 'schedule', label: 'Schedule', config: M.examSchedule },
                        { key: 'approval', label: 'Marks Approval', element: <MarksApproval /> },
                        { key: 'grades', label: 'Grade Bands', config: M.grades },
                      ]}
                    />
                  }
                />

                <Route path="results" element={<Resource config={M.results} />} />

                <Route
                  path="fees"
                  element={
                    <ModuleTabs
                      title="Fee Management"
                      subtitle="Fee categories, structures, student fees and collected payments."
                      tabs={[
                        { key: 'structures', label: 'Fee Structures', config: M.feeStructures },
                        { key: 'categories', label: 'Categories', config: M.feeCategories },
                        { key: 'student-fees', label: 'Student Fees', config: M.studentFees },
                        { key: 'payments', label: 'Payments', config: M.feePayments },
                        { key: 'income', label: 'Income', config: M.income },
                        { key: 'expenses', label: 'Expenses', config: M.expenses },
                        { key: 'petty-cash', label: 'Petty Cash', config: M.pettyCash },
                      ]}
                    />
                  }
                />

                <Route
                  path="payroll"
                  element={
                    <ModuleTabs
                      title="Payroll"
                      subtitle="Salary structures and monthly payroll."
                      tabs={[
                        { key: 'structures', label: 'Salary Structures', config: M.salaryStructures },
                        { key: 'payslips', label: 'My Payslips', element: <Payslips /> },
                      ]}
                    />
                  }
                />

                <Route
                  path="transport"
                  element={
                    <ModuleTabs
                      title="Transport"
                      subtitle="Vehicles, drivers, routes, student allocation, fuel and maintenance."
                      tabs={[
                        { key: 'routes', label: 'Routes', config: M.routes },
                        { key: 'vehicles', label: 'Vehicles', config: M.vehicles },
                        { key: 'drivers', label: 'Drivers', config: M.drivers },
                        { key: 'allocations', label: 'Student Transport', config: M.transportAllocations },
                        { key: 'fuel', label: 'Fuel', config: M.fuelRecords },
                        { key: 'maintenance', label: 'Maintenance', config: M.vehicleMaintenance },
                      ]}
                    />
                  }
                />

                <Route
                  path="library"
                  element={
                    <ModuleTabs
                      title="Library"
                      subtitle="Catalogue, circulation and fines."
                      tabs={[
                        { key: 'books', label: 'Books', config: M.books },
                        { key: 'transactions', label: 'Issue & Return', config: M.bookTransactions },
                        { key: 'fines', label: 'Fines', config: M.fines },
                      ]}
                    />
                  }
                />

                <Route
                  path="inventory"
                  element={
                    <ModuleTabs
                      title="Inventory & Assets"
                      subtitle="Stock, purchases and capital assets."
                      tabs={[
                        { key: 'items', label: 'Items', config: M.inventoryItems },
                        { key: 'categories', label: 'Categories', config: M.inventoryCategories },
                        { key: 'purchases', label: 'Purchases', config: M.purchases },
                        { key: 'assets', label: 'Assets', config: M.assets },
                      ]}
                    />
                  }
                />

                <Route path="announcements" element={<Resource config={M.announcements} />} />
                <Route path="notices" element={<Resource config={M.notices} />} />
                <Route path="reports" element={<Reports />} />

                <Route path="audit-logs" element={<AuditLogs />} />
                <Route path="settings" element={<SystemSettings />} />
                <Route path="storage" element={<DataStorage />} />
                <Route path="import" element={<DataImport />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RequireRole>
          }
        />

        {/* ============================================================
            2. ADMINISTRATOR — students, faculty and academic operations
            ============================================================ */}
        <Route
          path="/administrator/*"
          element={
            <RequireRole roles={['ADMINISTRATOR', 'ADMIN']}>
              <Routes>
                <Route path="dashboard" element={<AdministratorDashboard />} />
                <Route path="wings" element={<Departments basePath="/administrator" />} />

                <Route path="admission" element={<StudentAdmission />} />
                <Route path="students" element={<Students />} />
                <Route path="students/:id" element={<StudentProfile />} />
                <Route path="enrollment" element={<Resource config={M.enrollments} />} />
                <Route path="promotion" element={<StudentPromotion />} />
                <Route path="documents" element={<Resource config={M.documents} />} />
                <Route path="attendance" element={<AttendanceOverview />} />
                <Route path="results" element={<Resource config={M.results} />} />
                <Route path="fees" element={<Resource config={M.studentFees} />} />
                <Route path="transport" element={<Resource config={M.transportAllocations} />} />
                <Route path="mentoring" element={<Resource config={M.mentoring} />} />
                <Route path="leave" element={<LeaveRequests />} />
                <Route path="parents" element={<Parents />} />
                <Route path="password-resets" element={<PasswordResets />} />
                <Route path="assignments" element={<FacultyAssignments />} />

                <Route path="faculty" element={<Faculty />} />
                <Route path="faculty/:id" element={<FacultyProfile />} />
                <Route path="departments" element={<Resource config={M.departments} />} />
                <Route path="course-assignments" element={<Resource config={M.courseAssignments} />} />
                <Route path="faculty-attendance" element={<Resource config={M.facultyAttendance} />} />

                <Route path="academic-years" element={<Resource config={M.academicYears} />} />
                <Route path="classes" element={<Resource config={M.classes} />} />
                <Route path="sections" element={<Resource config={M.sections} />} />
                <Route path="subjects" element={<Resource config={M.subjects} />} />
                <Route path="courses" element={<Resource config={M.courses} />} />
                <Route path="timetable" element={<Resource config={M.timetable} />} />

                <Route path="examinations" element={<Resource config={M.examinations} />} />
                <Route path="exam-schedule" element={<Resource config={M.examSchedule} />} />
                <Route path="marks" element={<MarksApproval />} />
                <Route path="exam-results" element={<Resource config={M.results} />} />
                <Route path="grades" element={<Resource config={M.grades} />} />

                <Route path="announcements" element={<Resource config={M.announcements} />} />
                <Route path="notices" element={<Resource config={M.notices} />} />
                <Route path="circulars" element={<Resource config={M.circulars} />} />
                <Route path="reports" element={<Reports />} />

                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RequireRole>
          }
        />

        {/* ============================================================
            3A. FACULTY — TEACHING STAFF
            ============================================================ */}
        <Route
          path="/faculty/teaching/*"
          element={
            <RequireRole roles={['TEACHING_STAFF', 'ADMIN']}>
              <Routes>
                <Route path="dashboard" element={<TeachingDashboard />} />
                <Route path="courses" element={<MyCourses />} />
                <Route path="students" element={<MyStudents />} />
                <Route path="materials" element={<CourseMaterials />} />
                <Route path="attendance" element={<MarkAttendance />} />
                <Route path="attendance-history" element={<AttendanceOverview historyOnly />} />
                <Route path="marks" element={<MarksEntry />} />
                <Route path="timetable" element={<PortalTimetableForTeacher />} />
                <Route path="mentees" element={<MyMentees />} />
                <Route path="mentoring" element={<MentoringRecords />} />
                <Route path="students/:id" element={<StudentProfile basePath="/faculty/teaching" />} />
                <Route path="reports" element={<Reports />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RequireRole>
          }
        />

        {/* ============================================================
            3B. FACULTY — FINANCIAL STAFF
            ============================================================ */}
        <Route
          path="/faculty/financial/*"
          element={
            <RequireRole roles={['FINANCIAL_STAFF', 'ADMIN']}>
              <Routes>
                <Route path="dashboard" element={<FinancialDashboard />} />
                <Route path="fee-structures" element={<Resource config={M.feeStructures} />} />
                <Route path="collection" element={<FeeCollection />} />
                <Route path="pending" element={<PendingFees />} />
                <Route path="payments" element={<Resource config={M.feePayments} />} />
                <Route path="receipts" element={<FeeReceipts />} />
                <Route path="analysis" element={<FinancialAnalysis />} />
                <Route path="income" element={<Resource config={M.income} />} />
                <Route path="expenses" element={<Resource config={M.expenses} />} />
                <Route path="petty-cash" element={<Resource config={M.pettyCash} />} />
                <Route path="students" element={<Students basePath="/faculty/financial" />} />
                <Route path="students/:id" element={<StudentProfile basePath="/faculty/financial" />} />
                <Route path="student-fees" element={<Resource config={M.studentFees} />} />
                <Route path="faculty" element={<Faculty basePath="/faculty/financial" readOnly />} />
                <Route path="faculty/:id" element={<FacultyProfile basePath="/faculty/financial" />} />
                <Route path="transport" element={<Resource config={M.transportAllocations} />} />
                <Route path="fuel" element={<Resource config={M.fuelRecords} />} />
                <Route path="maintenance" element={<Resource config={M.vehicleMaintenance} />} />
                <Route path="payroll" element={<Resource config={M.payrollConfig} />} />
                <Route path="reports" element={<Reports />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RequireRole>
          }
        />

        {/* ============================================================
            4. STUDENTS & PARENTS — one section per family
            ============================================================ */}
        <Route
          path="/parent/*"
          element={
            <RequireRole roles={['PARENT', 'ADMIN']}>
              <Routes>
                <Route path="dashboard" element={<ParentDashboard />} />
                <Route path="profile" element={<PortalProfile />} />
                <Route path="attendance" element={<PortalAttendance />} />
                <Route path="performance" element={<PortalResults performanceView />} />
                <Route path="results" element={<PortalResults />} />
                <Route path="timetable" element={<PortalTimetable />} />
                <Route path="assignments" element={<PortalMaterials assignmentsOnly />} />
                <Route path="materials" element={<PortalMaterials />} />
                <Route path="courses" element={<PortalCourses />} />
                <Route path="fees" element={<PortalFees />} />
                <Route path="announcements" element={<PortalAnnouncements />} />
                <Route path="notices" element={<PortalNotices />} />
                <Route path="calendar" element={<PortalCalendar />} />
                <Route path="mentoring" element={<PortalMentoring />} />
                <Route path="transport" element={<PortalTransport />} />
                <Route path="circulars" element={<PortalCirculars />} />
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RequireRole>
          }
        />

        {/* ------------------------- shared across every role ------------------------- */}
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/leave" element={<LeaveRequests />} />
        <Route path="/profile" element={<MyProfile />} />
        <Route path="/change-password" element={<ChangePassword />} />
        {/* One route, six handbooks: the signed-in role picks which manual is shown. */}
        <Route path="/manual" element={<Manual />} />
        <Route path="/payslips" element={<Payslips />} />
        <Route path="/receipts/:id" element={<Receipt />} />
        <Route path="/report-card/:examinationId/:studentId" element={<ReportCard />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** A teacher's own timetable reuses the portal grid, keyed on their faculty id. */
function PortalTimetableForTeacher() {
  return <PortalTimetable />;
}
