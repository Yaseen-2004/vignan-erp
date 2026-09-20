import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, TrendChart } from '../../components/Charts.jsx';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  formatCurrency,
  formatDate,
  Meter,
  Stat,
  TableWrap,
  timeAgo,
} from '../../components/ui.jsx';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The shared student overview.
 *
 * The student portal renders this for the signed-in student; the parent portal
 * renders exactly the same view for the selected child, so both audiences see
 * a consistent picture. `prefix` switches the internal links between portals.
 */
export function StudentOverview({ dashboard, prefix = '/parent', showNotifications = true }) {
  if (!dashboard?.student) {
    return <EmptyState icon="graduation-cap" title="No student record" message="This account is not linked to a student profile yet." />;
  }

  const { student, attendance, courses, materials, results, fees, timetableToday, upcoming, transport, mentoring, notifications } = dashboard;
  const today = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const latestResult = results?.[0];

  return (
    <>
      <div className="profile-hero mb-5">
        <Avatar name={student.full_name} src={student.photo} size="lg" />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <h2>{student.full_name}</h2>
          <div className="meta">
            <span>
              <Icon name="id-card" size={13} /> {student.admission_number}
            </span>
            <span>
              <Icon name="grid" size={13} /> {student.class_name} {student.section_name}
            </span>
            <span>
              <Icon name="hash" size={13} /> Roll {student.roll_number || '—'}
            </span>
            <span>
              <Icon name="calendar" size={13} /> {student.academic_year_name || '—'}
            </span>
          </div>
        </div>
        <Link to={`${prefix}/profile`} className="btn btn-secondary btn-sm">
          View full profile
        </Link>
      </div>

      <div className="grid grid-stats mb-5">
        <Stat
          label="Attendance"
          value={`${attendance.percentage}%`}
          icon="calendar-check"
          tone={attendance.percentage >= 75 ? 'green' : attendance.percentage >= 60 ? 'amber' : 'red'}
          meta={`${attendance.present || 0} of ${attendance.total || 0} sessions`}
          onClick={undefined}
        />
        <Stat
          label="Latest Result"
          value={latestResult ? `${latestResult.percentage}%` : '—'}
          icon="award"
          tone={latestResult?.result_status === 'PASS' ? 'green' : latestResult ? 'red' : 'navy'}
          meta={latestResult ? `${latestResult.exam_name} · Grade ${latestResult.grade}` : 'No published results yet'}
        />
        <Stat
          label="Courses"
          value={courses?.length || 0}
          icon="book-open"
          tone="blue"
          meta={`${materials?.length || 0} recent materials`}
        />
        <Stat
          label="Fees Pending"
          value={formatCurrency(fees.pending)}
          icon="wallet"
          tone={Number(fees.pending) > 0 ? 'red' : 'green'}
          meta={fees.nextDue ? `Next due ${formatDate(fees.nextDue.due_date)}` : 'All settled'}
        />
      </div>

      <div className="grid grid-main mb-5">
        <div className="stack">
          <Card
            title={`Today's classes — ${DAYS[today]}`}
            bodyClass="flush"
            actions={<Link to={`${prefix}/timetable`} className="btn btn-ghost btn-sm">Timetable</Link>}
          >
            {timetableToday?.length ? (
              <TableWrap>
                <table className="data" style={{ minWidth: 460 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Period</th>
                      <th>Subject</th>
                      <th>Teacher</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timetableToday.map((slot) => (
                      <tr key={slot.period}>
                        <td>
                          <Badge tone="neutral" dot={false}>P{slot.period}</Badge>
                        </td>
                        <td className="cell-primary">{slot.course_name || '—'}</td>
                        <td className="text-muted">{slot.faculty_name || '—'}</td>
                        <td className="nowrap text-muted">
                          {slot.start_time} – {slot.end_time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="calendar" title="No classes today" message="There is no timetable entry for today." />
            )}
          </Card>

          <Card title="Monthly attendance">
            <BarsChart
              data={attendance.monthly || []}
              xKey="month"
              series={[{ key: 'percentage', label: 'Attendance %', color: '#245a9e' }]}
              formatter={(value) => `${value}%`}
              height={220}
            />
          </Card>

          {/* One result is a number; several are a direction, which is what a
              parent actually wants to see. Oldest first, so it reads left to
              right the way the year ran. */}
          <Card title="Results so far" hint="Percentage in each examination">
            <TrendChart
              data={[...(results || [])]
                .slice()
                .reverse()
                .map((row) => ({ exam: row.exam_name, percentage: row.percentage }))}
              xKey="exam"
              series={[{ key: 'percentage', label: 'Percentage', color: '#14b8a6' }]}
              formatter={(value) => `${value}%`}
              height={220}
            />
          </Card>

          <Card
            title="Recent course materials"
            bodyClass="flush"
            actions={<Link to={`${prefix}/${prefix === '/parent' ? 'assignments' : 'materials'}`} className="btn btn-ghost btn-sm">All</Link>}
          >
            {materials?.length ? (
              <div className="feed">
                {materials.slice(0, 6).map((material) => (
                  <div className="feed-item" key={material.id}>
                    <span className={`feed-icon ${material.material_type === 'ASSIGNMENT' ? 'tone-amber' : 'tone-purple'}`}>
                      <Icon name={materialIcon(material.material_type)} size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{material.title}</strong>
                      <p className="truncate">
                        {material.course_name} · {material.faculty_name}
                      </p>
                      {material.due_date && (
                        <span className="feed-time">Due {formatDate(material.due_date)}</span>
                      )}
                    </div>
                    {material.file_path ? (
                      <a href={material.file_path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                        <Icon name="download" size={14} />
                      </a>
                    ) : material.external_url ? (
                      <a href={material.external_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                        <Icon name="external-link" size={14} />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="files" title="No materials yet" message="Teachers will share notes and resources here." />
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Fees" actions={<Link to={`${prefix}/fees`} className="btn btn-ghost btn-sm">Details</Link>}>
            <div className="stack-sm">
              <div className="row-between">
                <span className="text-muted text-sm">Total</span>
                <strong>{formatCurrency(fees.total)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Paid</span>
                <strong className="text-success">{formatCurrency(fees.paid)}</strong>
              </div>
              <div className="row-between">
                <span className="text-muted text-sm">Pending</span>
                <strong className="text-danger">{formatCurrency(fees.pending)}</strong>
              </div>
              <div className="mt-3">
                <Meter label="Paid" value={fees.paidPercentage} />
              </div>
              {fees.nextDue && (
                <div className="mt-3 text-xs text-muted">
                  Next: {fees.nextDue.fee_name} — {formatCurrency(fees.nextDue.amount)} due{' '}
                  {formatDate(fees.nextDue.due_date)}
                </div>
              )}
            </div>
          </Card>

          <Card title="Upcoming" bodyClass="flush" hint="Exams, events and holidays">
            {upcoming?.length ? (
              <div className="feed">
                {upcoming.slice(0, 6).map((item, index) => (
                  <div className="feed-item" key={index}>
                    <span className={`feed-icon ${item.type === 'EXAM' ? 'tone-red' : 'tone-teal'}`}>
                      <Icon name={item.type === 'EXAM' ? 'clipboard-check' : 'calendar'} size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{item.title}</strong>
                      <p className="truncate">{item.subtitle}</p>
                    </div>
                    <span className="feed-time">{formatDate(item.date)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="calendar" title="Nothing scheduled" />
            )}
          </Card>

          <Card title="Mentoring & guidance" bodyClass="flush" actions={<Link to={`${prefix}/mentoring`} className="btn btn-ghost btn-sm">All</Link>}>
            {student.mentor_name && (
              <div className="feed-item" style={{ background: 'var(--navy-50)' }}>
                <Avatar name={student.mentor_name} size="sm" />
                <div className="feed-body">
                  <strong>{student.mentor_name}</strong>
                  <p>Assigned mentor · {student.mentor_code}</p>
                </div>
              </div>
            )}
            {mentoring?.length ? (
              <div className="feed">
                {mentoring.slice(0, 4).map((record) => (
                  <div className="feed-item" key={record.id}>
                    <span className="feed-icon tone-teal">
                      <Icon name="compass" size={14} />
                    </span>
                    <div className="feed-body">
                      <strong className="truncate">{record.title}</strong>
                      <p className="truncate">{record.notes}</p>
                    </div>
                    <span className="feed-time">{formatDate(record.meeting_date || record.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              !student.mentor_name && <EmptyState icon="compass" title="No mentoring records" />
            )}
          </Card>

          {transport && (
            <Card title="Transportation" actions={<Link to={`${prefix}/transport`} className="btn btn-ghost btn-sm">Details</Link>}>
              <div className="stack-sm text-sm">
                <div className="row-between">
                  <span className="text-muted">Route</span>
                  <strong>{transport.route_name}</strong>
                </div>
                <div className="row-between">
                  <span className="text-muted">Vehicle</span>
                  <strong>{transport.vehicle_number || '—'}</strong>
                </div>
                <div className="row-between">
                  <span className="text-muted">Pickup</span>
                  <strong>
                    {transport.pickup_point} · {transport.pickup_time}
                  </strong>
                </div>
                <div className="row-between">
                  <span className="text-muted">Driver</span>
                  <strong>{transport.driver_name || '—'}</strong>
                </div>
              </div>
            </Card>
          )}

          {showNotifications && (
            <Card title="Notifications" bodyClass="flush" actions={<Link to="/notifications" className="btn btn-ghost btn-sm">All</Link>}>
              {notifications?.length ? (
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
          )}
        </div>
      </div>

      <Card title="My courses" bodyClass="flush" actions={<Link to={`${prefix}/courses`} className="btn btn-ghost btn-sm">All courses</Link>}>
        {courses?.length ? (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Course</th>
                  <th>Faculty</th>
                  <th>Section</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td className="cell-primary">{course.subject_name}</td>
                    <td className="text-muted">{course.name}</td>
                    <td>{course.faculty_name || '—'}</td>
                    <td>{course.section_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState icon="book-open" title="No courses assigned" />
        )}
      </Card>
    </>
  );
}

function materialIcon(type) {
  const map = {
    NOTES: 'file-text',
    PDF: 'file-text',
    PRESENTATION: 'presentation',
    VIDEO: 'video',
    LINK: 'link',
    ASSIGNMENT: 'clipboard',
  };
  return map[type] || 'files';
}

export default StudentOverview;
