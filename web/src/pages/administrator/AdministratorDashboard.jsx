import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useDepartment } from '../../context/DepartmentContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart } from '../../components/Charts.jsx';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  formatNumber,
  Meter,
  PageHeader,
  Stat,
  StatSkeleton,
  TableWrap,
  timeAgo,
  useFetch,
} from '../../components/ui.jsx';

const QUICK_ACTIONS = [
  { label: 'Add Student', to: '/administrator/admission', icon: 'user-plus', tone: 'tone-blue' },
  { label: 'Add Faculty', to: '/administrator/faculty?new=1', icon: 'briefcase', tone: 'tone-purple' },
  { label: 'Assign Course', to: '/administrator/course-assignments?new=1', icon: 'link', tone: 'tone-teal' },
  { label: 'Create Timetable', to: '/administrator/timetable', icon: 'clock', tone: 'tone-navy' },
  { label: 'Create Announcement', to: '/administrator/announcements?new=1', icon: 'megaphone', tone: 'tone-amber' },
  { label: 'Create Exam', to: '/administrator/examinations?new=1', icon: 'clipboard-check', tone: 'tone-red' },
];

export function AdministratorDashboard() {
  const dept = useDepartment();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/dashboards/administrator${qs(dept.params)}`),
    [dept.department]
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Administrator Dashboard" subtitle="Loading..." />
        <StatSkeleton count={8} />
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { students, faculty, attendance, upcomingExams, pendingRequests, recentAnnouncements, recentAdmissions, classStrength, leaveQueue, byDepartment } = data;

  return (
    <>
      <PageHeader
        title="Administrator Dashboard"
        subtitle={
          dept.department
            ? `Student and faculty operations — ${dept.label} department.`
            : 'Student and faculty operations across both departments.'
        }
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Total Students" value={formatNumber(students.total)} icon="graduation-cap" tone="navy" meta={`${students.inactive} not active`} />
        <Stat label="Active Students" value={formatNumber(students.active)} icon="user-check" tone="green" meta="Currently enrolled" />
        <Stat label="New Admissions" value={formatNumber(students.newAdmissions)} icon="user-plus" tone="amber" meta="Last 30 days" />
        <Stat label="Total Faculty" value={formatNumber(faculty.total)} icon="briefcase" tone="purple" meta="Both categories" />
        <Stat label="Teaching Staff" value={formatNumber(faculty.teaching)} icon="book-open" tone="blue" meta="Academic delivery" />
        <Stat label="Financial Staff" value={formatNumber(faculty.financial)} icon="calculator" tone="teal" meta="Accounts & fees" />
        <Stat
          label="Student Attendance"
          value={`${attendance.student.percentage}%`}
          icon="calendar-check"
          tone={attendance.student.percentage >= 75 ? 'green' : 'red'}
          meta={`${formatNumber(attendance.student.present || 0)} of ${formatNumber(attendance.student.total || 0)} today`}
        />
        <Stat
          label="Faculty Attendance"
          value={`${attendance.faculty.percentage}%`}
          icon="user-check"
          tone={attendance.faculty.percentage >= 90 ? 'green' : 'amber'}
          meta={`${formatNumber(attendance.faculty.present || 0)} present today`}
        />
      </div>

      <Card title="Quick actions" className="mb-5">
        <div className="quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.label} to={action.to} className="quick-action">
              <span className={`qa-icon ${action.tone}`}>
                <Icon name={action.icon} size={16} />
              </span>
              <span className="flex-1 truncate">{action.label}</span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-main mb-5">
        <Card title="Pending requests" hint="Items waiting on your decision" bodyClass="flush">
          <div className="row row-wrap" style={{ padding: 16, gap: 24 }}>
            <div>
              <div className="stat-label">Leave requests</div>
              <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>{pendingRequests.leave}</div>
            </div>
            <div>
              <div className="stat-label">Marks approval</div>
              <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>{pendingRequests.marksApproval}</div>
            </div>
            <div>
              <div className="stat-label">Documents</div>
              <div className="stat-value" style={{ fontSize: 'var(--text-xl)' }}>{pendingRequests.documents}</div>
            </div>
            <div className="flex-1 text-right" style={{ alignSelf: 'center' }}>
              <Link to="/administrator/marks" className="btn btn-primary btn-sm">
                Review marks
              </Link>
            </div>
          </div>

          {leaveQueue.length ? (
            <TableWrap style={{ borderTop: '1px solid var(--border)' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Requester</th>
                    <th>Type</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Reason</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {leaveQueue.map((request) => (
                    <tr key={request.id}>
                      <td className="cell-primary">
                        {request.student_name || request.faculty_name || '—'}
                        <div className="cell-sub">{request.admission_number || request.requester_type}</div>
                      </td>
                      <td>
                        <Badge tone="neutral" dot={false}>{request.leave_type}</Badge>
                      </td>
                      <td className="nowrap">{formatDate(request.from_date)}</td>
                      <td className="nowrap">{formatDate(request.to_date)}</td>
                      <td className="truncate" style={{ maxWidth: 240 }}>{request.reason}</td>
                      <td className="actions">
                        <Link to="/administrator/leave" className="btn btn-ghost btn-sm">
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="check-circle" title="No pending leave requests" message="Everything has been reviewed." />
          )}
        </Card>

        <div className="stack">
          <Card title="Upcoming examinations" bodyClass="flush">
            {upcomingExams.length ? (
              <div className="feed">
                {upcomingExams.map((exam) => (
                  <div className="feed-item" key={exam.id}>
                    <span className="feed-icon tone-amber">
                      <Icon name="clipboard-check" size={14} />
                    </span>
                    <div className="feed-body">
                      <strong>{exam.name}</strong>
                      <p>
                        {formatDate(exam.start_date)} — {formatDate(exam.end_date)}
                      </p>
                    </div>
                    <Badge status={exam.status} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="calendar" title="No upcoming examinations" />
            )}
          </Card>

          <Card
            title="Recent announcements"
            bodyClass="flush"
            actions={<Link to="/administrator/announcements" className="btn btn-ghost btn-sm">All</Link>}
          >
            {recentAnnouncements.length ? (
              <div className="feed">
                {recentAnnouncements.slice(0, 5).map((item) => (
                  <div className="feed-item" key={item.id}>
                    <span className="feed-icon tone-navy">
                      <Icon name="megaphone" size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{item.title}</strong>
                      <p className="truncate">{item.content}</p>
                      <span className="feed-time">
                        {formatDate(item.publish_date)} · {item.target_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {!item.is_published && <Badge status="DRAFT">Draft</Badge>}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="megaphone" title="No announcements yet" />
            )}
          </Card>
        </div>
      </div>

      {/* The split between the two wings, beside the class-by-class detail. */}
      <div className="grid grid-2 mb-5">
        <Card title="Students by department" hint="How the school divides between the two wings">
          <DonutChart
            data={(byDepartment || []).map((row) => ({
              name: row.board === 'CBSE' ? 'CBSE' : 'State Board',
              value: row.students,
            }))}
            height={260}
          />
        </Card>

        <Card title="Class strength" hint="Active students per section">
          <BarsChart
            data={classStrength.slice(0, 14).map((row) => ({
              name: `${row.class_name} ${row.section_name}`,
              students: row.students,
            }))}
            xKey="name"
            series={[{ key: 'students', label: 'Students', color: '#245a9e' }]}
            height={260}
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card
          title="Recent admissions"
          bodyClass="flush"
          actions={<Link to="/administrator/students" className="btn btn-ghost btn-sm">All students</Link>}
        >
          {recentAdmissions.length ? (
            <div className="feed">
              {recentAdmissions.map((student) => (
                <Link
                  key={student.id}
                  to={`/administrator/students/${student.id}`}
                  className="feed-item"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <Avatar name={`${student.first_name} ${student.last_name || ''}`} src={student.photo} size="sm" />
                  <div className="feed-body">
                    <strong>
                      {student.first_name} {student.last_name}
                    </strong>
                    <p>
                      {student.admission_number} · {student.class_name} {student.section_name}
                    </p>
                  </div>
                  <span className="feed-time">{formatDate(student.admission_date)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon="user-plus" title="No admissions yet" />
          )}
        </Card>
      </div>
    </>
  );
}

export default AdministratorDashboard;
