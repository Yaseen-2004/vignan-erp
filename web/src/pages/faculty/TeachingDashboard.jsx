import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart } from '../../components/Charts.jsx';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  PageHeader,
  Stat,
  StatSkeleton,
  TableWrap,
  timeAgo,
  useFetch,
} from '../../components/ui.jsx';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** How many periods this teacher is in a room each day of the week. */
function weeklyLoad(timetable = []) {
  const perDay = new Map();
  for (const slot of timetable) perDay.set(slot.day_of_week, (perDay.get(slot.day_of_week) || 0) + 1);
  return [...perDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, periods]) => ({ day: SHORT_DAYS[day] || String(day), periods }));
}

/** Which classes their students sit in — the shape of their teaching load. */
function studentsPerClass(assignments = []) {
  const perClass = new Map();
  for (const item of assignments) {
    const label = `${item.class_name || ''} ${item.section_name || ''}`.trim() || 'Unassigned';
    perClass.set(label, (perClass.get(label) || 0) + (Number(item.student_count) || 0));
  }
  return [...perClass.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

const QUICK_ACTIONS = [
  { label: 'Mark Attendance', to: '/faculty/teaching/attendance', icon: 'calendar-check', tone: 'tone-green' },
  { label: 'Upload Material', to: '/faculty/teaching/materials?new=1', icon: 'upload', tone: 'tone-purple' },
  { label: 'Enter Marks', to: '/faculty/teaching/marks', icon: 'clipboard-check', tone: 'tone-amber' },
  { label: 'View Students', to: '/faculty/teaching/students', icon: 'graduation-cap', tone: 'tone-blue' },
  { label: 'My Mentees', to: '/faculty/teaching/mentees', icon: 'compass', tone: 'tone-teal' },
  { label: 'Mentoring Records', to: '/faculty/teaching/mentoring', icon: 'heart', tone: 'tone-red' },
];

export function TeachingDashboard() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useFetch(() => api.get('/dashboards/teaching'), []);

  if (loading) {
    return (
      <>
        <PageHeader title="Teaching Dashboard" subtitle="Loading your assignments..." />
        <StatSkeleton count={6} />
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { counts, assignments, todayClasses, attendanceToday, pendingMarks, materials, mentees, timetable, notifications } = data;
  const today = new Date().getDay() === 0 ? 7 : new Date().getDay();

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.fullName.split(' ')[0]}`}
        subtitle="Your assigned courses, classes, attendance and marks."
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Assigned Courses" value={counts.assignedCourses} icon="book-open" tone="navy" meta={`${counts.assignments} class assignments`} />
        <Stat label="Today's Classes" value={counts.todayClasses} icon="clock" tone="amber" meta={DAYS[today]} />
        <Stat label="Assigned Students" value={counts.students} icon="graduation-cap" tone="blue" meta="Across your sections" />
        <Stat
          label="Today's Attendance"
          value={attendanceToday.total ? `${attendanceToday.percentage}%` : 'Not marked'}
          icon="calendar-check"
          tone={attendanceToday.total ? 'green' : 'red'}
          meta={attendanceToday.total ? `${attendanceToday.present} of ${attendanceToday.total} present` : 'Mark attendance for today'}
        />
        <Stat label="Pending Marks" value={counts.pendingMarks} icon="clipboard-check" tone={counts.pendingMarks ? 'red' : 'green'} meta="Awaiting entry or resubmission" />
        <Stat label="Course Materials" value={counts.materials} icon="files" tone="purple" meta="Uploaded by you" />
        <Stat label="My Mentees" value={counts.mentees} icon="compass" tone="teal" meta="Students under your guidance" />
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
        <Card
          title={`Today's classes — ${DAYS[today]}`}
          bodyClass="flush"
          actions={<Link to="/faculty/teaching/timetable" className="btn btn-ghost btn-sm">Full timetable</Link>}
        >
          {todayClasses.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>Period</th>
                    <th>Course</th>
                    <th>Class</th>
                    <th>Time</th>
                    <th>Room</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {todayClasses.map((slot) => (
                    <tr key={slot.id}>
                      <td>
                        <Badge tone="neutral" dot={false}>P{slot.period}</Badge>
                      </td>
                      <td className="cell-primary">
                        {slot.course_name || slot.subject_name}
                        <div className="cell-sub">{slot.subject_name}</div>
                      </td>
                      <td>
                        {slot.class_name} {slot.section_name}
                      </td>
                      <td className="nowrap">
                        {slot.start_time} – {slot.end_time}
                      </td>
                      <td className="text-muted">{slot.room || '—'}</td>
                      <td className="actions">
                        <Link
                          to={`/faculty/teaching/attendance?section_id=${slot.section_id}&course_id=${slot.course_id ?? ''}&period=${slot.period}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Mark
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="calendar" title="No classes scheduled today" message="Enjoy the lighter day." />
          )}
        </Card>

        <div className="stack">
          <Card title="Pending marks" bodyClass="flush" hint="Exams for your courses">
            {pendingMarks.length ? (
              <div className="feed">
                {pendingMarks.slice(0, 6).map((item) => (
                  <Link
                    key={item.exam_subject_id}
                    to={`/faculty/teaching/marks?exam_subject_id=${item.exam_subject_id}`}
                    className="feed-item"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className={`feed-icon ${item.entered ? 'tone-amber' : 'tone-red'}`}>
                      <Icon name="clipboard-check" size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{item.subject_name}</strong>
                      <p className="truncate">{item.exam_name}</p>
                    </div>
                    <Badge tone={item.entered ? 'warning' : 'danger'} dot={false}>
                      {item.entered ? `${item.drafts} draft` : 'Not entered'}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon="check-circle" title="Nothing pending" message="All marks are entered and submitted." />
            )}
          </Card>

          <Card title="Notifications" bodyClass="flush" actions={<Link to="/notifications" className="btn btn-ghost btn-sm">All</Link>}>
            {notifications.length ? (
              <div className="feed">
                {notifications.slice(0, 5).map((item) => (
                  <div key={item.id} className={`feed-item ${item.is_read ? '' : 'unread'}`}>
                    <span className="feed-icon tone-navy">
                      <Icon name="bell" size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{item.title}</strong>
                      {item.body && <p className="truncate">{item.body}</p>}
                    </div>
                    <span className="feed-time">{timeAgo(item.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="bell" title="No notifications" />
            )}
          </Card>
        </div>
      </div>

      {/* The week at a glance: when they teach, and who they teach. */}
      <div className="grid grid-2 mb-5">
        <Card title="Periods per day" hint="Your teaching load across the week">
          <BarsChart
            data={weeklyLoad(timetable)}
            xKey="day"
            series={[{ key: 'periods', label: 'Periods', color: '#245a9e' }]}
            height={240}
            formatter={(value) => `${value} period${value === 1 ? '' : 's'}`}
          />
        </Card>

        <Card title="Students by class" hint="Across the sections assigned to you">
          <DonutChart data={studentsPerClass(assignments)} height={240} />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card
          title="My courses"
          bodyClass="flush"
          actions={<Link to="/faculty/teaching/courses" className="btn btn-ghost btn-sm">All</Link>}
        >
          {assignments.length ? (
            <TableWrap>
              <table className="data" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Class</th>
                    <th className="num">Students</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td className="cell-primary">
                        {item.subject_name}
                        <div className="cell-sub">{item.course_code}</div>
                      </td>
                      <td>
                        {item.class_name} {item.section_name}
                      </td>
                      <td className="num">{item.student_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="book-open" title="No courses assigned" message="An administrator will assign your courses." />
          )}
        </Card>

        <Card
          title="My mentees"
          bodyClass="flush"
          actions={<Link to="/faculty/teaching/mentees" className="btn btn-ghost btn-sm">All</Link>}
        >
          {mentees.length ? (
            <div className="feed">
              {mentees.slice(0, 6).map((mentee) => (
                <div className="feed-item" key={mentee.id}>
                  <Avatar name={`${mentee.first_name} ${mentee.last_name || ''}`} src={mentee.photo} size="sm" />
                  <div className="feed-body">
                    <strong>
                      {mentee.first_name} {mentee.last_name}
                    </strong>
                    <p>
                      {mentee.admission_number} · {mentee.class_name} {mentee.section_name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="compass" title="No mentees assigned" />
          )}
        </Card>
      </div>
    </>
  );
}

export default TeachingDashboard;
