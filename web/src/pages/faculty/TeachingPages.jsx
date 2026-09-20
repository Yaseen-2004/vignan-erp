import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { StudentsByClass } from '../../components/StudentsByClass.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  LoadingBlock,
  Meter,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  Tabs,
  useFetch,
} from '../../components/ui.jsx';

import { readChoice, writeSetting } from '../../lib/storage.js';
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ---------------------------------------------------------- my courses */
export function MyCourses() {
  const { data, loading, error, refetch } = useFetch(() => api.get('/dashboards/teaching'), []);
  const [roster, setRoster] = useState(null);

  const { data: students, loading: rosterLoading } = useFetch(
    () => api.get(`/academics/courses/${roster.course_id}/students`),
    [roster?.course_id],
    { skip: !roster }
  );

  if (loading) return <LoadingBlock label="Loading your courses" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const assignments = data.assignments || [];

  return (
    <>
      <PageHeader
        title="My Courses"
        subtitle="Only courses assigned to you appear here. You cannot access another teacher's course."
      />

      {!assignments.length ? (
        <Card>
          <EmptyState
            icon="book-open"
            title="No courses assigned"
            message="An administrator will assign your courses and sections."
          />
        </Card>
      ) : (
        <div className="course-grid">
          {assignments.map((assignment) => (
            <article className="course-card" key={assignment.id}>
              <header className="course-card-head">
                <span className={`course-mark ${assignment.board === 'CBSE' ? 'cbse' : 'state'}`}>
                  <Icon name="book-open" size={18} />
                </span>
                <div className="course-title">
                  <strong>{assignment.subject_name}</strong>
                  <span className="mono">{assignment.course_code}</span>
                </div>
                <Badge tone={assignment.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                  {assignment.board === 'CBSE' ? 'CBSE' : 'State'}
                </Badge>
              </header>

              <dl className="course-facts">
                <div>
                  <dt>Class</dt>
                  <dd>
                    {assignment.class_name} — {assignment.section_name}
                  </dd>
                </div>
                <div>
                  <dt>Students</dt>
                  <dd>{assignment.student_count}</dd>
                </div>
                <div className="span-all">
                  <dt>Course</dt>
                  <dd className="truncate" title={assignment.course_name}>
                    {assignment.course_name}
                  </dd>
                </div>
              </dl>

              <footer className="course-card-foot">
                <Button size="sm" icon="users" onClick={() => setRoster(assignment)}>
                  Roster
                </Button>
                <Link
                  to={`/faculty/teaching/attendance?section_id=${assignment.section_id}&course_id=${assignment.course_id}`}
                  className="btn btn-secondary btn-sm"
                >
                  <Icon name="calendar-check" size={13} /> Attendance
                </Link>
                <Link
                  to={`/faculty/teaching/materials?course_id=${assignment.course_id}`}
                  className="btn btn-ghost btn-sm"
                  title="Course materials"
                >
                  <Icon name="files" size={13} /> Material
                </Link>
              </footer>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!roster}
        onClose={() => setRoster(null)}
        size="wide"
        title={roster ? `${roster.subject_name} — ${roster.class_name} ${roster.section_name}` : ''}
        subtitle="Students enrolled in this course"
      >
        {rosterLoading ? (
          <LoadingBlock label="Loading roster" />
        ) : students?.length ? (
          <TableWrap>
            <table className="data" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>Roll</th>
                  <th>Student</th>
                  <th>Admission No</th>
                  <th>Section</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td className="mono">{student.roll_number || '—'}</td>
                    <td>
                      <div className="row-person">
                        <Avatar name={`${student.first_name} ${student.last_name || ''}`} src={student.photo} size="sm" />
                        <span className="cell-primary">
                          {student.first_name} {student.last_name}
                        </span>
                      </div>
                    </td>
                    <td className="mono">{student.admission_number}</td>
                    <td>{student.section_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState icon="users" title="No students" />
        )}
      </Modal>
    </>
  );
}

/* --------------------------------------------------------- my students */
export function MyStudents() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [sectionId, setSectionId] = useState('');

  // Class-wise first — a teacher works a section at a time. The flat list stays
  // available for finding one pupil across everything assigned to them.
  const [view, setView] = useState(() => readChoice('vignan.students.view', ['classes', 'all'], 'classes'));
  const choose = (next) => {
    setView(next);
    writeSetting('vignan.students.view', next);
  };

  const switcher = (
    <div className="view-switch" role="group" aria-label="Student list view">
      <button type="button" className={view === 'classes' ? 'on' : ''} onClick={() => choose('classes')}>
        <Icon name="grid" size={14} /> Class-wise
      </button>
      <button type="button" className={view === 'all' ? 'on' : ''} onClick={() => choose('all')}>
        <Icon name="list" size={14} /> All students
      </button>
    </div>
  );

  const { data: dashboard } = useFetch(() => api.get('/dashboards/teaching'), []);
  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/students${qs({ page, limit: 25, section_id: sectionId, status: 'ACTIVE' })}`),
    [page, sectionId]
  );

  const sections = [...new Map((dashboard?.assignments || []).map((a) => [a.section_id, a])).values()];

  return (
    <>
      <PageHeader
        title="My Students"
        subtitle="Students in the sections assigned to you, plus your mentees."
        actions={switcher}
      />

      {view === 'classes' ? (
        <StudentsByClass basePath="/faculty/teaching" />
      ) : (
      <Card bodyClass="flush">
        <div className="toolbar">
          <Select
            className="compact"
            value={sectionId}
            options={sections.map((s) => ({
              value: String(s.section_id),
              label: `${s.class_name} ${s.section_name}`,
            }))}
            placeholder="All my sections"
            onChange={(event) => {
              setSectionId(event.target.value);
              setPage(1);
            }}
          />
          <div className="toolbar-spacer" />
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} aria-label="Refresh" />
        </div>

        <DataTable
          onRowClick={(row) => navigate(`/faculty/teaching/students/${row.id}`)}
          loading={loading}
          error={error}
          onRetry={refetch}
          rows={data}
          meta={meta}
          onPageChange={setPage}
          emptyTitle="No students"
          emptyMessage="You have no assigned sections yet."
          columns={[
            {
              key: 'student',
              label: 'Student',
              render: (row) => (
                <div className="row-person">
                  <Avatar name={row.full_name} src={row.photo} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="cell-primary truncate">{row.full_name}</div>
                    <div className="cell-sub mono">{row.admission_number}</div>
                  </div>
                </div>
              ),
            },
            { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
            { key: 'roll_number', label: 'Roll No', render: (row) => row.roll_number || '—' },
            { key: 'gender', label: 'Gender', render: (row) => row.gender || '—' },
            { key: 'mentor_name', label: 'Mentor', render: (row) => row.mentor_name || '—' },
            { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
          ]}
          mobileColumns={['class_name', 'roll_number', 'status']}
        />
      </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------- mentees */
export function MyMentees() {
  const { data, loading, error, refetch } = useFetch(() => api.get('/mentoring/mentees/list'), []);

  if (loading) return <LoadingBlock label="Loading your mentees" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const atRisk = (data || []).filter((mentee) => mentee.attendance_percentage != null && mentee.attendance_percentage < 75);

  return (
    <>
      <PageHeader
        title="My Mentees"
        subtitle="Students under your guidance, with attendance and latest performance."
        actions={
          <Link to="/faculty/teaching/mentoring" className="btn btn-primary">
            <Icon name="plus" size={16} /> Add mentoring record
          </Link>
        }
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Mentees" value={data?.length ?? 0} icon="compass" tone="teal" />
        <Stat label="Attendance below 75%" value={atRisk.length} icon="alert-triangle" tone={atRisk.length ? 'red' : 'green'} />
        <Stat
          label="Records logged"
          value={(data || []).reduce((sum, mentee) => sum + Number(mentee.record_count || 0), 0)}
          icon="file-text"
          tone="navy"
        />
      </div>

      {!data?.length ? (
        <Card>
          <EmptyState icon="compass" title="No mentees assigned" message="An administrator assigns mentees to mentors." />
        </Card>
      ) : (
        <div className="grid grid-3">
          {data.map((mentee) => (
            <Card key={mentee.id}>
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={`${mentee.first_name} ${mentee.last_name || ''}`} src={mentee.photo} />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <strong className="truncate" style={{ display: 'block' }}>
                    {mentee.first_name} {mentee.last_name}
                  </strong>
                  <span className="text-xs text-muted mono">{mentee.admission_number}</span>
                  <div className="text-xs text-muted">
                    {mentee.class_name} {mentee.section_name}
                  </div>
                </div>
              </div>

              <div className="mt-4 stack-sm">
                {mentee.attendance_percentage != null && (
                  <Meter label="Attendance" value={mentee.attendance_percentage} />
                )}
                <div className="row-between text-sm">
                  <span className="text-muted">Latest result</span>
                  <strong>
                    {mentee.last_percentage != null ? `${mentee.last_percentage}%` : '—'}
                    {mentee.last_grade ? ` (${mentee.last_grade})` : ''}
                  </strong>
                </div>
                <div className="row-between text-sm">
                  <span className="text-muted">Records</span>
                  <strong>{mentee.record_count}</strong>
                </div>
                <div className="row-between text-sm">
                  <span className="text-muted">Last meeting</span>
                  <strong>{mentee.last_meeting ? formatDate(mentee.last_meeting) : 'None'}</strong>
                </div>
              </div>

              <div className="row" style={{ gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                <Link to={`/faculty/teaching/students/${mentee.id}`} className="btn btn-primary btn-sm flex-1">
                  <Icon name="eye" size={13} /> View record
                </Link>
                <Link
                  to={`/faculty/teaching/mentoring?student_id=${mentee.id}&new=1`}
                  className="btn btn-secondary btn-sm"
                  title="Add a mentoring record"
                >
                  <Icon name="plus" size={13} />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
