import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  ErrorState,
  formatCurrency,
  formatDate,
  formatDateTime,
  LoadingBlock,
  Meter,
  PageHeader,
  Stat,
  TableWrap,
  Tabs,
  useFetch,
} from '../../components/ui.jsx';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function FacultyProfile({ basePath = '/administrator' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');

  const { data, loading, error, refetch } = useFetch(() => api.get(`/faculty/${id}/profile`), [id]);

  if (loading) return <LoadingBlock label="Loading faculty profile" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { faculty, assignments, attendance, leaves, documents, mentees, timetable, salary, activity } = data;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'assignments', label: 'Assigned Courses' },
    { key: 'timetable', label: 'Timetable' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'mentees', label: 'Mentees' },
    { key: 'leave', label: 'Leave' },
    ...(salary ? [{ key: 'salary', label: 'Salary' }] : []),
    { key: 'documents', label: 'Documents' },
  ];

  const attendancePercent = attendance?.total
    ? Number(((attendance.present / attendance.total) * 100).toFixed(1))
    : 0;

  return (
    <>
      <PageHeader
        title={faculty.full_name}
        subtitle={`${faculty.faculty_code} · ${faculty.designation || faculty.staff_type}`}
        actions={
          <Button icon="arrow-left" onClick={() => navigate(`${basePath}/faculty`)}>
            Back to faculty
          </Button>
        }
      />

      <div className="profile-hero mb-5">
        <Avatar name={faculty.full_name} src={faculty.photo} size="lg" />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <h2>{faculty.full_name}</h2>
          <div className="meta">
            <span>
              <Icon name="id-card" size={13} /> {faculty.faculty_code}
            </span>
            <span>
              <Icon name="layers" size={13} />{' '}
              {faculty.board === 'BOTH'
                ? 'Both departments'
                : faculty.board === 'CBSE'
                  ? 'CBSE department'
                  : 'State Board department'}
            </span>
            <span>
              <Icon name="briefcase" size={13} /> {faculty.designation || '—'}
            </span>
            <span>
              <Icon name="building" size={13} /> {faculty.department_name || '—'} (subject)
            </span>
            <span>
              <Icon name="mail" size={13} /> {faculty.email}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Badge status={faculty.staff_type}>{faculty.staff_type}</Badge>
          <Badge status={faculty.status}>{faculty.status}</Badge>
        </div>
      </div>

      <div className="grid grid-stats mb-5">
        <Stat label="Assigned Courses" value={faculty.assigned_courses} icon="book-open" tone="navy" />
        <Stat label="Mentees" value={faculty.mentee_count} icon="compass" tone="teal" />
        <Stat
          label="Attendance"
          value={`${attendancePercent}%`}
          icon="user-check"
          tone={attendancePercent >= 90 ? 'green' : 'amber'}
          meta={`${attendance?.present || 0} of ${attendance?.total || 0} days`}
        />
        <Stat label="Experience" value={`${faculty.experience_years || 0} yrs`} icon="award" tone="purple" meta={faculty.qualification} />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <Card title="Professional details">
            <DetailList
              items={[
                { label: 'Faculty ID', value: faculty.faculty_code },
                { label: 'Category', value: <Badge status={faculty.staff_type}>{faculty.staff_type}</Badge> },
                { label: 'Role', value: faculty.role_code?.replace(/_/g, ' ') },
                { label: 'Designation', value: faculty.designation },
                { label: 'Department', value: faculty.department_name },
                { label: 'Qualification', value: faculty.qualification },
                { label: 'Specialization', value: faculty.specialization },
                { label: 'Experience', value: faculty.experience_years ? `${faculty.experience_years} years` : null },
                { label: 'Date of joining', value: formatDate(faculty.date_of_joining) },
                { label: 'Mentor', value: faculty.is_mentor ? 'Yes' : 'No' },
              ]}
            />
          </Card>
          <Card title="Contact & personal">
            <DetailList
              items={[
                { label: 'Email', value: faculty.email },
                { label: 'Phone', value: faculty.phone },
                { label: 'Username', value: faculty.username },
                { label: 'Gender', value: faculty.gender },
                { label: 'Date of birth', value: formatDate(faculty.date_of_birth) },
                { label: 'Blood group', value: faculty.blood_group },
                { label: 'Emergency contact', value: faculty.emergency_contact },
                { label: 'Address', value: faculty.address },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'assignments' && (
        <Card title="Assigned courses" hint="These assignments define what this teacher may access" bodyClass="flush">
          {assignments.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Course</th>
                    <th>Class</th>
                    <th>Section</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((row) => (
                    <tr key={row.id}>
                      <td className="cell-primary">{row.subject_name}</td>
                      <td className="text-muted">{row.course_name}</td>
                      <td>{row.class_name}</td>
                      <td>{row.section_name}</td>
                      <td>
                        <Badge status={row.status}>{row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="book-open" title="No courses assigned" message="Assign courses from the Course Assignment module." />
          )}
        </Card>
      )}

      {tab === 'timetable' && (
        <Card title="Weekly timetable" bodyClass="flush">
          {timetable.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Period</th>
                    <th>Course</th>
                    <th>Class</th>
                    <th>Time</th>
                    <th>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {timetable.map((slot) => (
                    <tr key={slot.id}>
                      <td className="cell-primary">{DAYS[slot.day_of_week]}</td>
                      <td>
                        <Badge tone="neutral" dot={false}>
                          P{slot.period}
                        </Badge>
                      </td>
                      <td>{slot.course_name || '—'}</td>
                      <td>
                        {slot.class_name} {slot.section_name}
                      </td>
                      <td className="nowrap">
                        {slot.start_time} – {slot.end_time}
                      </td>
                      <td className="text-muted">{slot.room || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="clock" title="No timetable entries" />
          )}
        </Card>
      )}

      {tab === 'attendance' && (
        <Card title="Attendance summary">
          <div className="grid grid-stats" style={{ gap: 12 }}>
            <Stat label="Present" value={attendance?.present || 0} icon="check-circle" tone="green" />
            <Stat label="Absent" value={attendance?.absent || 0} icon="x-circle" tone="red" />
            <Stat label="Leave" value={attendance?.leave_count || 0} icon="calendar" tone="blue" />
            <Stat label="Recorded days" value={attendance?.total || 0} icon="history" tone="navy" />
          </div>
          <div className="mt-5">
            <Meter label="Attendance" value={attendancePercent} />
          </div>
        </Card>
      )}

      {tab === 'mentees' && (
        <Card title="Mentees" bodyClass="flush">
          {mentees.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Admission No</th>
                    <th>Class</th>
                    <th>Section</th>
                  </tr>
                </thead>
                <tbody>
                  {mentees.map((mentee) => (
                    <tr key={mentee.id}>
                      <td className="cell-primary">
                        {mentee.first_name} {mentee.last_name}
                      </td>
                      <td className="mono">{mentee.admission_number}</td>
                      <td>{mentee.class_name}</td>
                      <td>{mentee.section_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="compass" title="No mentees assigned" />
          )}
        </Card>
      )}

      {tab === 'leave' && (
        <Card title="Leave history" bodyClass="flush">
          {leaves.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Days</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((leave) => (
                    <tr key={leave.id}>
                      <td>{formatDate(leave.from_date)}</td>
                      <td>{formatDate(leave.to_date)}</td>
                      <td className="num">{leave.days}</td>
                      <td>
                        <Badge tone="neutral" dot={false}>
                          {leave.leave_type}
                        </Badge>
                      </td>
                      <td>{leave.reason}</td>
                      <td>
                        <Badge status={leave.status}>{leave.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="clipboard" title="No leave requests" />
          )}
        </Card>
      )}

      {tab === 'salary' && salary && (
        <div className="grid grid-2">
          <Card title="Salary structure" hint="Visible to payroll managers and the employee">
            {salary.structure ? (
              <DetailList
                items={[
                  { label: 'Basic salary', value: formatCurrency(salary.structure.basic_salary) },
                  { label: 'HRA', value: formatCurrency(salary.structure.hra) },
                  { label: 'DA', value: formatCurrency(salary.structure.da) },
                  { label: 'Conveyance', value: formatCurrency(salary.structure.conveyance) },
                  { label: 'Medical', value: formatCurrency(salary.structure.medical) },
                  { label: 'Other allowances', value: formatCurrency(salary.structure.other_allowances) },
                  { label: 'PF deduction', value: formatCurrency(salary.structure.pf_deduction) },
                  { label: 'Tax deduction', value: formatCurrency(salary.structure.tax_deduction) },
                  { label: 'Effective from', value: formatDate(salary.structure.effective_from) },
                ]}
              />
            ) : (
              <EmptyState icon="banknote" title="No salary structure" />
            )}
          </Card>
          <Card title="Recent payslips" bodyClass="flush">
            {salary.recent?.length ? (
              <TableWrap>
                <table className="data" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th>Payslip</th>
                      <th>Period</th>
                      <th className="num">Net Pay</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salary.recent.map((payslip) => (
                      <tr key={payslip.id}>
                        <td className="mono">{payslip.payslip_number}</td>
                        <td>
                          {payslip.month}/{payslip.year}
                        </td>
                        <td className="num fw-700">{formatCurrency(payslip.net_salary)}</td>
                        <td>
                          <Badge status={payslip.status}>{payslip.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="receipt" title="No payslips generated" />
            )}
          </Card>
        </div>
      )}

      {tab === 'documents' && (
        <Card title="Documents" bodyClass="flush">
          {documents.length ? (
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {documents.map((document) => (
                <div className="doc-item" key={document.id}>
                  <span className="doc-icon tone-navy">
                    <Icon name="file-text" size={16} />
                  </span>
                  <div className="doc-meta">
                    <strong>{document.title}</strong>
                    <span>
                      {document.document_type || 'General'} · {formatDateTime(document.created_at)}
                    </span>
                  </div>
                  <a href={document.file_path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    <Icon name="download" size={14} />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="files" title="No documents uploaded" />
          )}
        </Card>
      )}
    </>
  );
}

export default FacultyProfile;
