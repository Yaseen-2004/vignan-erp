import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart } from '../../components/Charts.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  ErrorState,
  fileSize,
  formatCurrency,
  formatDate,
  formatDateTime,
  LoadingBlock,
  Meter,
  Modal,
  PageHeader,
  Stat,
  TableWrap,
  Tabs,
  useFetch,
} from '../../components/ui.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'academic', label: 'Academic' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'results', label: 'Results' },
  { key: 'fees', label: 'Fees' },
  { key: 'parents', label: 'Parents' },
  { key: 'transport', label: 'Transport' },
  { key: 'mentoring', label: 'Mentoring' },
  { key: 'documents', label: 'Documents' },
  { key: 'leave', label: 'Leave' },
  { key: 'activity', label: 'Activity' },
];

/** Student 360° profile — every panel the specification lists. */
export function StudentProfile({ basePath = '/administrator' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [idCardOpen, setIdCardOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data, loading, error, refetch } = useFetch(() => api.get(`/students/${id}/profile`), [id]);
  const { data: idCard } = useFetch(() => api.get(`/students/${id}/id-card`), [id, idCardOpen], { skip: !idCardOpen });

  if (loading) return <LoadingBlock label="Loading student profile" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { student, attendance, courses, results, fees, parents, transport, mentoring, documents, leaves, enrollmentHistory, activity } = data;
  const staffView = ['ADMIN', 'ADMINISTRATOR', 'TEACHING_STAFF', 'FINANCIAL_STAFF'].includes(user.role);

  const uploadDocument = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('title', file.name);
    setUploading(true);
    try {
      await api.post(`/students/${id}/documents`, body);
      toast.success('Document uploaded');
      refetch();
    } catch (uploadError) {
      toast.fromError(uploadError, 'Upload failed');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('photo', file);
    try {
      await api.post(`/students/${id}/photo`, body);
      toast.success('Photo updated');
      refetch();
    } catch (uploadError) {
      toast.fromError(uploadError, 'Upload failed');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title={student.full_name}
        subtitle={`${student.admission_number} · ${student.class_name || ''} ${student.section_name || ''}`}
        actions={
          <>
            <Button icon="arrow-left" onClick={() => navigate(`${basePath}/students`)}>
              Back
            </Button>
            <Button icon="id-card" onClick={() => setIdCardOpen(true)}>
              ID Card
            </Button>
            {can('students.edit') && (
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <Icon name="image" size={16} /> Photo
                <input type="file" accept="image/*" hidden onChange={uploadPhoto} />
              </label>
            )}
          </>
        }
      />

      <div className="profile-hero mb-5">
        <Avatar name={student.full_name} src={student.photo} size="lg" />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <h2>{student.full_name}</h2>
          <div className="meta">
            <span>
              <Icon name="id-card" size={13} /> {student.admission_number}
            </span>
            <span>
              <Icon name="layers" size={13} />{' '}
              {student.board === 'CBSE' ? 'CBSE department' : 'State Board department'}
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
            {student.mentor_name && (
              <span>
                <Icon name="compass" size={13} /> {student.mentor_name}
              </span>
            )}
          </div>
        </div>
        <Badge status={student.status}>{student.status}</Badge>
      </div>

      <div className="grid grid-stats mb-5">
        <Stat
          label="Attendance"
          value={`${attendance.percentage}%`}
          icon="calendar-check"
          tone={attendance.percentage >= 75 ? 'green' : 'red'}
          meta={`${attendance.present || 0} of ${attendance.total || 0}`}
        />
        <Stat label="Courses" value={courses.length} icon="book-open" tone="blue" meta="Enrolled subjects" />
        <Stat
          label="Fees Pending"
          value={formatCurrency(fees.summary.pending)}
          icon="wallet"
          tone={Number(fees.summary.pending) > 0 ? 'red' : 'green'}
          meta={`${formatCurrency(fees.summary.paid)} paid`}
        />
        <Stat
          label="Published Results"
          value={results.length}
          icon="award"
          tone="purple"
          meta={results[0] ? `Latest ${results[0].percentage}%` : 'None yet'}
        />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <Card title="Personal information">
            <DetailList
              items={[
                { label: 'Full name', value: student.full_name },
                { label: 'Student ID', value: student.admission_number },
                { label: 'Date of birth', value: formatDate(student.date_of_birth) },
                { label: 'Gender', value: student.gender },
                { label: 'Blood group', value: student.blood_group },
                { label: 'Religion', value: student.religion },
                { label: 'Category', value: student.category },
                { label: 'Nationality', value: student.nationality },
                { label: 'Aadhaar', value: student.aadhaar_number },
              ]}
            />
          </Card>
          <Card title="Contact information">
            <DetailList
              items={[
                { label: 'Phone', value: student.phone },
                { label: 'Email', value: student.email },
                { label: 'Address', value: student.address },
                { label: 'City', value: student.city },
                { label: 'State', value: student.state },
                { label: 'Pincode', value: student.pincode },
                { label: 'Previous school', value: student.previous_school },
                { label: 'Admission date', value: formatDate(student.admission_date) },
                { label: 'Login username', value: student.username },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'academic' && (
        <div className="stack">
          <Card title="Assigned courses" bodyClass="flush">
            {courses.length ? (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Course</th>
                      <th>Faculty</th>
                      <th>Class</th>
                      <th>Section</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((course) => (
                      <tr key={course.id}>
                        <td className="cell-primary">{course.subject_name}</td>
                        <td className="text-muted">{course.name}</td>
                        <td>{course.faculty_name || '—'}</td>
                        <td>{course.class_name}</td>
                        <td>{course.section_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="book-open" title="No courses" />
            )}
          </Card>

          <Card title="Enrollment history" bodyClass="flush" hint="Previous academic years remain available">
            {enrollmentHistory.length ? (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Academic Year</th>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Roll No</th>
                      <th>Enrolled</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollmentHistory.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-primary">{row.academic_year_name}</td>
                        <td>{row.class_name}</td>
                        <td>{row.section_name}</td>
                        <td>{row.roll_number || '—'}</td>
                        <td>{formatDate(row.enrollment_date)}</td>
                        <td>
                          <Badge status={row.status}>{row.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="file-check" title="No enrolment history" />
            )}
          </Card>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="grid grid-2">
          <Card title="Attendance summary">
            <div className="grid grid-stats" style={{ gap: 12 }}>
              <Stat label="Present" value={attendance.present || 0} icon="check-circle" tone="green" />
              <Stat label="Absent" value={attendance.absent || 0} icon="x-circle" tone="red" />
              <Stat label="Sessions" value={attendance.total || 0} icon="calendar" tone="blue" />
            </div>
            <div className="mt-5">
              <Meter label="Overall" value={attendance.percentage} />
            </div>
          </Card>
          <Card title="Attendance detail">
            <p className="text-muted text-sm mb-4">
              {attendance.total || 0} sessions recorded. The attendance percentage is calculated from present sessions.
            </p>
            <Link to={`${basePath}/attendance?student_id=${student.id}`} className="btn btn-secondary btn-sm">
              <Icon name="history" size={14} /> Open full attendance register
            </Link>
          </Card>
        </div>
      )}

      {tab === 'results' && (
        <Card title="Published results" bodyClass="flush">
          {results.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Examination</th>
                    <th>Type</th>
                    <th className="num">Marks</th>
                    <th className="num">Percentage</th>
                    <th>Grade</th>
                    <th className="num">Rank</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id}>
                      <td className="cell-primary">{result.exam_name}</td>
                      <td className="text-muted">{result.exam_type?.replace(/_/g, ' ')}</td>
                      <td className="num">
                        {result.obtained_marks} / {result.total_marks}
                      </td>
                      <td className="num fw-700">{result.percentage}%</td>
                      <td>
                        <Badge tone="info" dot={false}>
                          {result.grade}
                        </Badge>
                      </td>
                      <td className="num">{result.rank_in_class || '—'}</td>
                      <td>
                        <Badge status={result.result_status}>{result.result_status}</Badge>
                      </td>
                      <td className="actions">
                        <Link
                          to={`/report-card/${result.examination_id}/${student.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          <Icon name="printer" size={14} /> Report card
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="award" title="No published results" message="Results appear once an administrator publishes them." />
          )}
        </Card>
      )}

      {tab === 'fees' && (
        <div className="stack">
          <div className="grid grid-stats">
            <Stat label="Total Billed" value={formatCurrency(fees.summary.total)} icon="receipt" tone="navy" />
            <Stat label="Paid" value={formatCurrency(fees.summary.paid)} icon="check-circle" tone="green" />
            <Stat label="Outstanding" value={formatCurrency(fees.summary.pending)} icon="alert-circle" tone="red" />
          </div>
          <Card title="Fee records" bodyClass="flush">
            {fees.rows.length ? (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Fee Head</th>
                      <th>Category</th>
                      <th className="num">Billed</th>
                      <th className="num">Discount</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Due Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.rows.map((row) => {
                      const balance = row.total_amount - row.discount_amount - row.paid_amount;
                      return (
                        <tr key={row.id}>
                          <td className="cell-primary">{row.fee_name}</td>
                          <td className="text-muted">{row.category_name}</td>
                          <td className="num">{formatCurrency(row.total_amount)}</td>
                          <td className="num">{formatCurrency(row.discount_amount)}</td>
                          <td className="num">{formatCurrency(row.paid_amount)}</td>
                          <td className="num">
                            <strong className={balance > 0 ? 'text-danger' : 'text-success'}>
                              {formatCurrency(balance)}
                            </strong>
                          </td>
                          <td>{formatDate(row.due_date)}</td>
                          <td>
                            <Badge status={row.status}>{row.status}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="wallet" title="No fee records" />
            )}
          </Card>
        </div>
      )}

      {tab === 'parents' && (
        <Card title="Parents & guardians" bodyClass="flush">
          {parents.length ? (
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Parent Code</th>
                    <th>Father</th>
                    <th>Mother</th>
                    <th>Contact</th>
                    <th>Relation</th>
                    <th>Login</th>
                  </tr>
                </thead>
                <tbody>
                  {parents.map((parent) => (
                    <tr key={parent.id}>
                      <td className="mono">{parent.parent_code}</td>
                      <td>
                        <div className="cell-primary">{parent.father_name || '—'}</div>
                        <div className="cell-sub">{parent.father_occupation}</div>
                      </td>
                      <td>
                        <div className="cell-primary">{parent.mother_name || '—'}</div>
                        <div className="cell-sub">{parent.mother_occupation}</div>
                      </td>
                      <td>
                        {parent.phone || parent.father_phone || '—'}
                        <div className="cell-sub">{parent.email}</div>
                      </td>
                      <td>
                        <Badge tone="neutral" dot={false}>
                          {parent.relation}
                        </Badge>
                      </td>
                      <td className="mono">{parent.username || 'No account'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState icon="users" title="No parent linked" message="Link a parent account from the Parents module." />
          )}
        </Card>
      )}

      {tab === 'transport' && (
        <Card title="Transportation">
          {transport ? (
            <DetailList
              items={[
                { label: 'Route', value: `${transport.route_name} (${transport.route_code})` },
                { label: 'Vehicle', value: transport.vehicle_number },
                { label: 'Vehicle type', value: transport.vehicle_type },
                { label: 'Driver', value: transport.driver_name },
                { label: 'Driver phone', value: transport.driver_phone },
                { label: 'Pickup point', value: transport.pickup_point },
                { label: 'Pickup time', value: transport.pickup_time },
                { label: 'Drop point', value: transport.drop_point },
                { label: 'Drop time', value: transport.drop_time },
                { label: 'Fare', value: formatCurrency(transport.fare) },
                { label: 'Status', value: <Badge status={transport.status}>{transport.status}</Badge> },
              ]}
            />
          ) : (
            <EmptyState icon="bus" title="No transport allocated" message="This student does not use school transport." />
          )}
        </Card>
      )}

      {tab === 'mentoring' && (
        <Card title="Mentoring records" bodyClass="flush">
          {mentoring.length ? (
            <div className="feed">
              {mentoring.map((record) => (
                <div className="feed-item" key={record.id}>
                  <span className="feed-icon tone-teal">
                    <Icon name="compass" size={14} />
                  </span>
                  <div className="feed-body">
                    <strong>{record.title}</strong>
                    <p>{record.notes}</p>
                    <span className="feed-time">
                      {record.mentor_name} · {formatDate(record.meeting_date || record.created_at)}
                      {record.action_items ? ` · ${record.action_items}` : ''}
                    </span>
                  </div>
                  <Badge tone="neutral" dot={false}>
                    {record.record_type}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="compass" title="No mentoring records" />
          )}
        </Card>
      )}

      {tab === 'documents' && (
        <Card
          title="Documents"
          bodyClass="flush"
          actions={
            can('documents.create') && (
              <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
                {uploading ? <span className="spinner" /> : <Icon name="upload" size={14} />} Upload
                <input type="file" hidden onChange={uploadDocument} disabled={uploading} />
              </label>
            )
          }
        >
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
                      {document.document_type || 'General'} · {fileSize(document.file_size)} ·{' '}
                      {formatDate(document.created_at)}
                    </span>
                  </div>
                  <Badge tone={document.verified ? 'success' : 'warning'} dot={false}>
                    {document.verified ? 'Verified' : 'Pending'}
                  </Badge>
                  <a href={document.file_path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    <Icon name="download" size={14} />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="files" title="No documents uploaded" message="Birth certificates, transfer certificates and photographs go here." />
          )}
        </Card>
      )}

      {tab === 'leave' && (
        <Card title="Leave requests" bodyClass="flush">
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

      {tab === 'activity' && (
        <Card title="Activity history" bodyClass="flush" hint="Audited changes to this student record">
          {staffView && activity.length ? (
            <div className="feed">
              {activity.map((entry, index) => (
                <div className="feed-item" key={index}>
                  <span className="feed-icon tone-navy">
                    <Icon name="history" size={14} />
                  </span>
                  <div className="feed-body">
                    <strong>{entry.description}</strong>
                    <p>
                      {entry.user_name} · {entry.module}
                    </p>
                  </div>
                  <span className="feed-time">{formatDateTime(entry.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="history" title="No recorded activity" message="Changes to this record will be listed here." />
          )}
        </Card>
      )}

      <Modal open={idCardOpen} onClose={() => setIdCardOpen(false)} title="Student ID Card" size="narrow">
        {idCard ? (
          <div className="receipt" style={{ padding: 20, maxWidth: 340, margin: '0 auto' }}>
            <div className="doc-header" style={{ paddingBottom: 12, marginBottom: 14 }}>
              <h2 style={{ fontSize: 'var(--text-lg)' }}>{idCard.campus?.name}</h2>
              <p className="text-xs">{idCard.campus?.address}, {idCard.campus?.city}</p>
              <span className="doc-title" style={{ fontSize: 10, padding: '3px 12px' }}>
                Student Identity Card
              </span>
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
              <Avatar name={idCard.student.full_name} src={idCard.student.photo} size="lg" />
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 'var(--text-md)', display: 'block' }}>{idCard.student.full_name}</strong>
                <span className="text-sm text-muted mono">{idCard.student.admission_number}</span>
              </div>
            </div>
            <DetailList
              items={[
                { label: 'Class', value: `${idCard.student.class_name || ''} ${idCard.student.section_name || ''}` },
                { label: 'Roll No', value: idCard.student.roll_number },
                { label: 'Academic Year', value: idCard.student.academic_year_name },
                { label: 'Blood Group', value: idCard.student.blood_group },
                { label: 'Phone', value: idCard.student.phone },
                { label: 'Route', value: idCard.transport?.route_name },
              ]}
            />
            <div className="no-print mt-5">
              <Button variant="primary" icon="printer" className="btn-block" onClick={() => window.print()}>
                Print ID card
              </Button>
            </div>
          </div>
        ) : (
          <LoadingBlock label="Preparing ID card" />
        )}
      </Modal>
    </>
  );
}

export default StudentProfile;
