import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useActiveStudent } from '../../hooks/useActiveStudent.js';
import { ChildSwitcher } from '../parent/ChildSwitcher.jsx';
import { Icon } from '../../components/Icon.jsx';
import { BarsChart, DonutChart } from '../../components/Charts.jsx';
import {
  Avatar,
  Badge,
  Card,
  DetailList,
  EmptyState,
  ErrorState,
  formatCurrency,
  formatCurrencyExact,
  formatDate,
  LoadingBlock,
  Meter,
  PageHeader,
  Stat,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

function NoChild() {
  return (
    <Card>
      <EmptyState icon="users" title="No student selected" message="No student record is linked to this account." />
    </Card>
  );
}

/* ---------------------------------------------------------- attendance */
export function PortalAttendance() {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/attendance/summary/${studentId}`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily, subject-wise and monthly attendance. This record is read-only." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading || !data ? (
        <LoadingBlock label="Loading attendance" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid grid-stats mb-5">
            <Stat
              label="Overall Attendance"
              value={`${data.overall.percentage}%`}
              icon="calendar-check"
              tone={data.overall.percentage >= 75 ? 'green' : data.overall.percentage >= 60 ? 'amber' : 'red'}
              meta={`${data.overall.present || 0} of ${data.overall.total || 0} sessions`}
            />
            <Stat label="Present" value={data.overall.present || 0} icon="check-circle" tone="green" />
            <Stat label="Absent" value={data.overall.absent || 0} icon="x-circle" tone="red" />
          </div>

          {data.overall.percentage < 75 && (
            <div className="error-state mb-5">
              <Icon name="alert-triangle" size={20} />
              <div>
                <strong>Attendance is below the 75% requirement</strong>
                <p className="text-sm">Please speak to the class teacher about improving attendance.</p>
              </div>
            </div>
          )}

          <div className="grid grid-2 mb-5">
            <Card title="Monthly attendance">
              <BarsChart
                data={data.monthly.slice().reverse()}
                xKey="month"
                series={[{ key: 'percentage', label: 'Attendance %', color: '#245a9e' }]}
                formatter={(value) => `${value}%`}
              />
            </Card>
            <Card title="Attendance breakdown">
              <DonutChart
                data={[
                  { name: 'Present', value: data.overall.present || 0 },
                  { name: 'Absent', value: data.overall.absent || 0 },
                ].filter((item) => item.value > 0)}
              />
            </Card>
          </div>

          {data.bySubject.length > 0 && (
            <Card title="Subject attendance" className="mb-5">
              <div className="stack-sm">
                {data.bySubject.map((subject) => (
                  <Meter
                    key={subject.course_id}
                    label={subject.subject_name}
                    value={subject.percentage}
                  />
                ))}
              </div>
            </Card>
          )}

          <Card title="Recent attendance" bodyClass="flush" hint="Last 30 records">
            {data.recent.length ? (
              <TableWrap>
                <table className="data" style={{ minWidth: 420 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Subject</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((row, index) => (
                      <tr key={index}>
                        <td className="cell-primary nowrap">{formatDate(row.attendance_date)}</td>
                        <td>{row.course_name || 'Daily register'}</td>
                        <td>{row.period ? `P${row.period}` : 'Full day'}</td>
                        <td>
                          <Badge status={row.status}>{row.status}</Badge>
                        </td>
                        <td className="text-muted">{row.remarks || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="calendar-check" title="No attendance recorded yet" />
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- results */
export function PortalResults({ performanceView = false }) {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/exams/results${qs({ student_id: studentId, limit: 50, sort: 'id', order: 'desc' })}`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  const results = data || [];
  const trend = results
    .slice()
    .reverse()
    .map((result) => ({ name: result.exam_name?.slice(0, 18), percentage: result.percentage }));

  return (
    <>
      <PageHeader
        title={performanceView ? 'Academic Performance' : 'Results'}
        subtitle="Published examination results with marks, grade and rank."
      />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading results" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !results.length ? (
        <Card>
          <EmptyState
            icon="award"
            title="No results published yet"
            message="Results appear here once the school publishes them."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-stats mb-5">
            <Stat
              label="Latest Percentage"
              value={`${results[0].percentage}%`}
              icon="percent"
              tone={results[0].result_status === 'PASS' ? 'green' : 'red'}
              meta={results[0].exam_name}
            />
            <Stat label="Latest Grade" value={results[0].grade || '—'} icon="award" tone="purple" />
            <Stat label="Class Rank" value={results[0].rank_in_class || '—'} icon="trending-up" tone="amber" />
            <Stat
              label="Examinations"
              value={results.length}
              icon="clipboard-check"
              tone="navy"
              meta={`${results.filter((r) => r.result_status === 'PASS').length} passed`}
            />
          </div>

          {trend.length > 1 && (
            <Card title="Performance trend" className="mb-5">
              <BarsChart
                data={trend}
                xKey="name"
                series={[{ key: 'percentage', label: 'Percentage', color: '#8b5cf6' }]}
                formatter={(value) => `${value}%`}
              />
            </Card>
          )}

          <Card title="Examination results" bodyClass="flush">
            <TableWrap>
              <table className="data">
                <thead>
                  <tr>
                    <th>Examination</th>
                    <th className="num">Marks</th>
                    <th className="num">Percentage</th>
                    <th>Grade</th>
                    <th className="num">Rank</th>
                    <th>Attendance</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id}>
                      <td>
                        <div className="cell-primary">{result.exam_name}</div>
                        <div className="cell-sub">{result.exam_type?.replace(/_/g, ' ')}</div>
                      </td>
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
                      <td>{result.attendance_percent != null ? `${result.attendance_percent}%` : '—'}</td>
                      <td>
                        <Badge status={result.result_status}>{result.result_status}</Badge>
                      </td>
                      <td className="actions">
                        <Link to={`/report-card/${result.examination_id}/${studentId}`} className="btn btn-secondary btn-sm">
                          <Icon name="file-text" size={13} /> Report card
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- fees */
export function PortalFees() {
  const { studentId, prefix, hasChildren } = useActiveStudent();

  const { data: fees, loading, error, refetch } = useFetch(
    () => api.get(`/finance/student-fees${qs({ student_id: studentId, limit: 50 })}`),
    [studentId],
    { skip: !studentId }
  );
  const { data: receipts } = useFetch(
    () => api.get(`/finance/receipts${qs({ student_id: studentId })}`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  const summary = (fees || []).reduce(
    (acc, row) => ({
      total: acc.total + Number(row.total_amount - row.discount_amount),
      paid: acc.paid + Number(row.paid_amount),
      balance: acc.balance + Number(row.balance),
    }),
    { total: 0, paid: 0, balance: 0 }
  );
  const paidPercent = summary.total ? Number(((summary.paid / summary.total) * 100).toFixed(1)) : 0;

  return (
    <>
      <PageHeader title="Fees" subtitle="Fee structure, payments made, outstanding balance and receipts." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading fee details" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="grid grid-stats mb-5">
            <Stat label="Total Fees" value={formatCurrency(summary.total)} icon="receipt" tone="navy" />
            <Stat label="Paid Amount" value={formatCurrency(summary.paid)} icon="check-circle" tone="green" />
            <Stat
              label="Pending Amount"
              value={formatCurrency(summary.balance)}
              icon="alert-circle"
              tone={summary.balance > 0 ? 'red' : 'green'}
            />
            <Stat label="Paid" value={`${paidPercent}%`} icon="percent" tone="blue" />
          </div>

          <Card title="Fee structure" bodyClass="flush" className="mb-5">
            {fees?.length ? (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Fee Head</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                      <th className="num">Concession</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Due Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-primary">{row.fee_name}</td>
                        <td className="text-muted">{row.category_name}</td>
                        <td className="num">{formatCurrencyExact(row.total_amount)}</td>
                        <td className="num">{formatCurrencyExact(row.discount_amount)}</td>
                        <td className="num">{formatCurrencyExact(row.paid_amount)}</td>
                        <td className="num">
                          <strong className={row.balance > 0 ? 'text-danger' : 'text-success'}>
                            {formatCurrencyExact(row.balance)}
                          </strong>
                        </td>
                        <td className="nowrap">{formatDate(row.due_date)}</td>
                        <td>
                          <Badge status={row.status}>{row.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="wallet" title="No fees assigned" />
            )}
          </Card>

          <Card title="Payment history & receipts" bodyClass="flush">
            {receipts?.length ? (
              <TableWrap>
                <table className="data" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>Receipt No</th>
                      <th>Date</th>
                      <th>Mode</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((receipt) => (
                      <tr key={receipt.id}>
                        <td className="mono cell-primary">{receipt.receipt_number}</td>
                        <td className="nowrap">{formatDate(receipt.payment_date)}</td>
                        <td>
                          <Badge tone="neutral" dot={false}>
                            {receipt.payment_mode}
                          </Badge>
                        </td>
                        <td className="num fw-700">{formatCurrencyExact(receipt.amount)}</td>
                        <td className="actions">
                          <Link to={`/receipts/${receipt.id}`} className="btn btn-secondary btn-sm">
                            <Icon name="printer" size={13} /> Receipt
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState icon="receipt" title="No payments yet" message="Receipts appear here after a payment is made." />
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------------- mentoring */
export function PortalMentoring() {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/students/${studentId}/profile`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  return (
    <>
      <PageHeader title="Mentoring & Guidance" subtitle="Your assigned mentor, guidance records, remarks and meetings." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading mentoring records" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          {data.mentor ? (
            <Card title="Your mentor" hint="Reach out about progress, attendance or any concern" className="mb-5">
              <div className="row row-wrap mb-4" style={{ gap: 16, alignItems: 'flex-start' }}>
                <Avatar name={data.mentor.full_name} src={data.mentor.photo} size="lg" />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 'var(--text-lg)', display: 'block' }}>{data.mentor.full_name}</strong>
                  <div className="text-sm text-muted">
                    {data.mentor.designation || 'Teacher'}
                    {data.mentor.department_name ? ` · ${data.mentor.department_name}` : ''}
                  </div>
                  <div className="row row-wrap mt-2" style={{ gap: 6 }}>
                    <Badge tone="neutral" dot={false}>{data.mentor.faculty_code}</Badge>
                    <Badge tone={data.mentor.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                      {data.mentor.board === 'BOTH'
                        ? 'Both departments'
                        : data.mentor.board === 'CBSE'
                          ? 'CBSE'
                          : 'State Board'}
                    </Badge>
                    {data.mentor.mentee_count > 0 && (
                      <Badge tone="neutral" dot={false}>{data.mentor.mentee_count} mentees</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-2" style={{ gap: 16 }}>
                <DetailList
                  items={[
                    {
                      label: 'Email',
                      value: data.mentor.email ? (
                        <a href={`mailto:${data.mentor.email}`} className="truncate">
                          {data.mentor.email}
                        </a>
                      ) : null,
                    },
                    {
                      label: 'Phone',
                      value: data.mentor.phone ? <a href={`tel:${data.mentor.phone}`}>{data.mentor.phone}</a> : null,
                    },
                    { label: 'Faculty ID', value: data.mentor.faculty_code },
                    { label: 'Designation', value: data.mentor.designation },
                  ]}
                />
                <DetailList
                  items={[
                    { label: 'Department', value: data.mentor.department_name },
                    { label: 'Qualification', value: data.mentor.qualification },
                    { label: 'Specialisation', value: data.mentor.specialization },
                    {
                      label: 'Experience',
                      value: data.mentor.experience_years ? `${data.mentor.experience_years} years` : null,
                    },
                    {
                      label: 'Teaches you',
                      value: data.mentor.teaches?.length
                        ? data.mentor.teaches.map((t) => t.subject_name).join(', ')
                        : null,
                    },
                    { label: 'Last meeting', value: data.mentor.last_meeting ? formatDate(data.mentor.last_meeting) : null },
                  ]}
                />
              </div>

              <div className="row row-wrap mt-4" style={{ gap: 8 }}>
                <Link to="/messages" className="btn btn-primary btn-sm">
                  <Icon name="mail" size={14} /> Message mentor
                </Link>
                {data.mentor.email && (
                  <a href={`mailto:${data.mentor.email}`} className="btn btn-secondary btn-sm">
                    <Icon name="send" size={14} /> Email
                  </a>
                )}
                {data.mentor.phone && (
                  <a href={`tel:${data.mentor.phone}`} className="btn btn-secondary btn-sm">
                    <Icon name="phone" size={14} /> Call
                  </a>
                )}
              </div>
            </Card>
          ) : (
            <Card className="mb-5">
              <EmptyState
                icon="compass"
                title="No mentor assigned yet"
                message="The school will assign a mentor shortly. Contact the office if this seems wrong."
              />
            </Card>
          )}

          <Card title="Guidance records" bodyClass="flush">
            {data.mentoring?.length ? (
              <div className="feed">
                {data.mentoring.map((record) => (
                  <div className="feed-item" key={record.id}>
                    <span className="feed-icon tone-teal">
                      <Icon name="compass" size={15} />
                    </span>
                    <div className="feed-body">
                      <strong>{record.title}</strong>
                      <p>{record.notes}</p>
                      {record.action_items && (
                        <p className="text-xs" style={{ color: 'var(--navy-600)' }}>
                          <Icon name="target" size={12} /> {record.action_items}
                        </p>
                      )}
                      <span className="feed-time">
                        {record.mentor_name} · {formatDate(record.meeting_date || record.created_at)}
                      </span>
                    </div>
                    <Badge tone="neutral" dot={false}>
                      {record.record_type}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="compass" title="No mentoring records" message="Records from your mentor appear here." />
            )}
          </Card>
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------------- transport */
export function PortalTransport() {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/students/${studentId}/profile`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) return <NoChild />;

  const transport = data?.transport;

  return (
    <>
      <PageHeader title="Transportation" subtitle="Your route, vehicle, driver and pickup details." />
      {prefix === '/parent' && <ChildSwitcher />}

      {loading ? (
        <LoadingBlock label="Loading transport details" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !transport ? (
        <Card>
          <EmptyState
            icon="bus"
            title="No transport allocated"
            message="This student does not use school transport. Contact the office to request it."
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          <Card title="Route details">
            <DetailList
              items={[
                { label: 'Route', value: transport.route_name },
                { label: 'Route code', value: transport.route_code },
                { label: 'Pickup point', value: transport.pickup_point },
                { label: 'Pickup time', value: transport.pickup_time },
                { label: 'Drop point', value: transport.drop_point },
                { label: 'Drop time', value: transport.drop_time },
                { label: 'Fare', value: transport.fare ? formatCurrency(transport.fare) : null },
                { label: 'Status', value: <Badge status={transport.status}>{transport.status}</Badge> },
              ]}
            />
          </Card>
          <Card title="Vehicle & driver">
            <div className="row mb-4" style={{ gap: 14 }}>
              <span className="stat-icon tone-navy" style={{ width: 48, height: 48 }}>
                <Icon name="bus" size={24} />
              </span>
              <div>
                <strong style={{ fontSize: 'var(--text-lg)', display: 'block' }}>{transport.vehicle_number || '—'}</strong>
                <span className="text-muted text-sm">{transport.vehicle_type || 'Vehicle'}</span>
              </div>
            </div>
            <DetailList
              items={[
                { label: 'Driver', value: transport.driver_name },
                { label: 'Driver phone', value: transport.driver_phone },
              ]}
            />
            {transport.driver_phone && (
              <a href={`tel:${transport.driver_phone}`} className="btn btn-secondary btn-block mt-4">
                <Icon name="phone" size={15} /> Call the driver
              </a>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
