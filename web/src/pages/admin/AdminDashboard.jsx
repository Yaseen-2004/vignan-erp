import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useDepartment } from '../../context/DepartmentContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart, TrendChart } from '../../components/Charts.jsx';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  formatCurrency,
  formatNumber,
  Meter,
  PageHeader,
  Skeleton,
  Stat,
  StatSkeleton,
  TableWrap,
  timeAgo,
  useFetch,
} from '../../components/ui.jsx';

const QUICK_ACTIONS = [
  { label: 'Add Administrator', to: '/admin/administrators?new=1', icon: 'user-cog', tone: 'tone-navy' },
  { label: 'Add Faculty', to: '/admin/faculty?new=1', icon: 'briefcase', tone: 'tone-purple' },
  { label: 'Add Student', to: '/admin/students?new=1', icon: 'graduation-cap', tone: 'tone-blue' },
  { label: 'Add Parent', to: '/admin/parents?new=1', icon: 'users', tone: 'tone-teal' },
  { label: 'Create Announcement', to: '/admin/announcements?new=1', icon: 'megaphone', tone: 'tone-amber' },
  { label: 'Create Notice', to: '/admin/notices?new=1', icon: 'file-text', tone: 'tone-gold' },
  { label: 'Create Course', to: '/admin/academics?tab=courses&new=1', icon: 'book-open', tone: 'tone-green' },
  { label: 'Create Exam', to: '/admin/examinations?new=1', icon: 'clipboard-check', tone: 'tone-red' },
  { label: 'Generate Report', to: '/admin/reports', icon: 'bar-chart', tone: 'tone-navy' },
];

export function AdminDashboard() {
  const dept = useDepartment();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/dashboards/admin${qs(dept.params)}`),
    [dept.department]
  );

  if (loading) {
    return (
      <>
        <PageHeader title="System Overview" subtitle="Loading institutional data..." />
        <StatSkeleton count={8} />
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { counts, attendance, fees, examinations, transport, usersByRole, enrollmentByClass, recentActivity, notifications } = data;

  return (
    <>
      <PageHeader
        title="System Overview"
        subtitle={
          dept.department
            ? `Complete control of the Vignan ERP. Figures below are scoped to the ${dept.label} department.`
            : 'Complete control of the Vignan ERP — users, academics, finance and configuration.'
        }
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Total Administrators" value={formatNumber(counts.administrators)} icon="user-cog" tone="navy" meta="Manage students & faculty" />
        <Stat label="Total Faculty" value={formatNumber(counts.faculty)} icon="briefcase" tone="purple" meta={`${counts.teachingStaff} teaching · ${counts.financialStaff} financial`} />
        <Stat label="Teaching Staff" value={formatNumber(counts.teachingStaff)} icon="book-open" tone="blue" meta="Academic operations" />
        <Stat label="Financial Staff" value={formatNumber(counts.financialStaff)} icon="calculator" tone="teal" meta="Fees & accounts" />
        <Stat label="Total Students" value={formatNumber(counts.students)} icon="graduation-cap" tone="green" meta={`Across ${counts.classes} classes`} />
        <Stat label="Total Parents" value={formatNumber(counts.parents)} icon="users" tone="amber" meta="Linked guardian accounts" />
        <Stat label="Total Classes" value={formatNumber(counts.classes)} icon="grid" tone="gold" meta={`${counts.courses} courses running`} />
        <Stat label="Total Courses" value={formatNumber(counts.courses)} icon="layers" tone="navy" meta={`${counts.campuses} campus(es)`} />
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
        <Card title="Attendance overview" hint="Last 14 days, all classes">
          <div className="row row-wrap mb-4" style={{ gap: 20 }}>
            <div>
              <div className="stat-label">Today</div>
              <div className="stat-value" style={{ fontSize: 'var(--text-2xl)' }}>
                {attendance.today.percentage}%
              </div>
            </div>
            <div>
              <div className="stat-label">Present</div>
              <div className="fw-700 text-lg text-success">{formatNumber(attendance.today.present || 0)}</div>
            </div>
            <div>
              <div className="stat-label">Absent</div>
              <div className="fw-700 text-lg text-danger">{formatNumber(attendance.today.absent || 0)}</div>
            </div>
            <div>
              <div className="stat-label">Marked</div>
              <div className="fw-700 text-lg">{formatNumber(attendance.today.total || 0)}</div>
            </div>
          </div>
          <TrendChart
            data={attendance.trend}
            xKey="date"
            series={[{ key: 'percentage', label: 'Attendance %', color: '#245a9e' }]}
            formatter={(value) => `${value}%`}
          />
        </Card>

        <div className="stack">
          <Card title="Fee overview">
            <div className="stack-sm">
              <div className="row-between">
                <span className="text-muted text-sm">Billed</span>
                <strong>{formatCurrency(fees.billed)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Collected</span>
                <strong className="text-success">{formatCurrency(fees.collected)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Outstanding</span>
                <strong className="text-danger">{formatCurrency(fees.pending)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">This month</span>
                <strong>{formatCurrency(fees.collectionMonth)}</strong>
              </div>
              <div className="mt-3">
                <Meter label="Collection" value={fees.collectionRate} />
              </div>
            </div>
          </Card>

          <Card title="Examination overview">
            <div className="stack-sm">
              <div className="row-between">
                <span className="text-muted text-sm">Total examinations</span>
                <strong>{examinations.total}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Upcoming</span>
                <strong>{examinations.upcoming}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Marks awaiting approval</span>
                <Badge status={examinations.pendingApproval ? 'PENDING' : 'APPROVED'}>
                  {examinations.pendingApproval || 'None'}
                </Badge>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Published results</span>
                <strong>{formatNumber(examinations.resultsPublished)}</strong>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-2 mb-5">
        <Card title="Enrollment by class">
          <BarsChart
            data={enrollmentByClass}
            xKey="class_name"
            series={[{ key: 'students', label: 'Students', color: '#245a9e' }]}
          />
        </Card>

        <Card title="Users by role">
          <DonutChart
            data={usersByRole.filter((r) => r.count > 0).map((r) => ({ name: r.role_name, value: r.count }))}
          />
        </Card>
      </div>

      <div className="grid grid-2 mb-5">
        <Card title="Transport overview">
          <div className="grid grid-stats" style={{ gap: 12 }}>
            <Stat label="Vehicles" value={transport.vehicles} icon="bus" tone="navy" />
            <Stat label="Routes" value={transport.routes} icon="route" tone="teal" />
            <Stat label="Students" value={formatNumber(transport.studentsAllocated)} icon="users" tone="green" />
            <Stat label="Drivers" value={transport.drivers} icon="user" tone="amber" />
          </div>
        </Card>

        <Card
          title="System notifications"
          bodyClass="flush"
          actions={<Link to="/notifications" className="btn btn-ghost btn-sm">View all</Link>}
        >
          {notifications.length ? (
            <div className="feed">
              {notifications.slice(0, 5).map((item) => (
                <div key={item.id} className={`feed-item ${item.is_read ? '' : 'unread'}`}>
                  <span className="feed-icon tone-navy">
                    <Icon name="bell" size={14} />
                  </span>
                  <div className="feed-body">
                    <strong>{item.title}</strong>
                    {item.body && <p className="truncate">{item.body}</p>}
                  </div>
                  <span className="feed-time">{timeAgo(item.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="bell" title="No notifications" message="System notifications will appear here." />
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        hint="Every important action is written to the audit log"
        bodyClass="flush"
        actions={<Link to="/admin/audit-logs" className="btn btn-ghost btn-sm">Open audit log</Link>}
      >
        {recentActivity.length ? (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Description</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="cell-primary">{entry.user_name || 'System'}</td>
                    <td>
                      <Badge tone="neutral" dot={false}>
                        {entry.role_code || '—'}
                      </Badge>
                    </td>
                    <td>
                      <Badge status={entry.status === 'FAILED' ? 'FAILED' : 'ACTIVE'} dot={false}>
                        {entry.action}
                      </Badge>
                    </td>
                    <td className="text-muted">{entry.module || '—'}</td>
                    <td>{entry.description}</td>
                    <td className="text-muted nowrap">{timeAgo(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState icon="history" title="No activity recorded yet" />
        )}
      </Card>
    </>
  );
}

export default AdminDashboard;
