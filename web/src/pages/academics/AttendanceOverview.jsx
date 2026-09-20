import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { TrendChart } from '../../components/Charts.jsx';
import {
  Badge, Button, Card, EmptyState, Field, Input, Meter, PageHeader, Select, Skeleton,
  Stat, Tabs, formatDate, useFetch,
} from '../../components/ui.jsx';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Student attendance for administrators — a daily overview plus the full
 * register with filters. Teachers see the same page scoped to their students.
 */
export function AttendanceOverview({ historyOnly = false }) {
  const { lookups } = useLookups();
  const { can } = useAuth();

  const [tab, setTab] = useState(historyOnly ? 'records' : 'overview');
  const [date, setDate] = useState(today());
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ section_id: '', status: '', from: '', to: '' });

  const { data: overview, loading: overviewLoading } = useFetch(
    () => api.get(`/attendance/overview?date=${date}`),
    [date],
    { skip: tab !== 'overview' }
  );

  const { data: records, meta, loading, error, refetch } = useFetch(
    () => api.get(`/attendance/students${qs({ page, limit: 30, ...filters })}`),
    [page, filters],
    { skip: tab !== 'records' }
  );

  const tabs = historyOnly
    ? [{ key: 'records', label: 'Attendance Records' }]
    : [
        { key: 'overview', label: 'Daily Overview' },
        { key: 'records', label: 'Attendance Records' },
      ];

  return (
    <>
      <PageHeader
        title={historyOnly ? 'Attendance History' : 'Student Attendance'}
        subtitle={
          historyOnly
            ? 'Attendance you have recorded, and the register for your students.'
            : 'Daily attendance across the institution, with the full register.'
        }
        actions={
          can('attendance.create') && (
            <Button variant="primary" icon="calendar-check" onClick={() => window.location.assign('/faculty/teaching/attendance')}>
              Mark attendance
            </Button>
          )
        }
      />

      {!historyOnly && <Tabs tabs={tabs} active={tab} onChange={setTab} pill />}

      {tab === 'overview' && (
        <div className="mt-4">
          <Card className="mb-4">
            <Field label="Date">
              <Input type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} style={{ maxWidth: 220 }} />
            </Field>
          </Card>

          {overviewLoading ? (
            <Card>
              <Skeleton variant="row" count={6} />
            </Card>
          ) : overview ? (
            <>
              <div className="grid grid-stats mb-5">
                <Stat
                  label="Attendance today"
                  value={`${overview.totals.marked ? Math.round(((overview.totals.present || 0) / overview.totals.marked) * 100) : 0}%`}
                  icon="calendar-check"
                  tone="navy"
                  meta={`${overview.totals.marked || 0} students marked`}
                />
                <Stat label="Present" value={overview.totals.present || 0} icon="check-circle" tone="green" />
                <Stat label="Absent" value={overview.totals.absent || 0} icon="x-circle" tone="red" />
              </div>

              <div className="grid grid-main">
                <Card title="Attendance trend" hint="Last 14 days">
                  <TrendChart
                    data={overview.trend}
                    xKey="date"
                    series={[{ key: 'percentage', label: 'Attendance %', color: '#245a9e' }]}
                    formatter={(value) => `${value}%`}
                  />
                </Card>
                <Card title="By class & section" hint="Attendance for the selected date">
                  {overview.byClass.length ? (
                    <div className="stack-sm">
                      {overview.byClass.map((row, index) => (
                        <Meter
                          key={index}
                          label={`${row.class_name} ${row.section_name || ''}`}
                          value={row.percentage}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="calendar-check" title="Not marked yet" message="No attendance recorded for this date." />
                  )}
                </Card>
              </div>
            </>
          ) : null}
        </div>
      )}

      {tab === 'records' && (
        <Card bodyClass="flush" className="mt-4">
          <div className="toolbar">
            <Select
              className="compact"
              value={filters.section_id}
              options={(lookups.sections || []).map((s) => ({ value: String(s.id), label: `${s.class_name} — ${s.name}` }))}
              placeholder="All sections"
              onChange={(event) => {
                setFilters({ ...filters, section_id: event.target.value });
                setPage(1);
              }}
            />
            <Select
              className="compact"
              value={filters.status}
              options={['PRESENT', 'ABSENT'].map((v) => ({ value: v, label: v }))}
              placeholder="All statuses"
              onChange={(event) => {
                setFilters({ ...filters, status: event.target.value });
                setPage(1);
              }}
            />
            <Input
              type="date"
              style={{ width: 160 }}
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
            <Input
              type="date"
              style={{ width: 160 }}
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
            {Object.values(filters).some(Boolean) && (
              <Button
                size="sm"
                variant="ghost"
                icon="x"
                onClick={() => {
                  setFilters({ section_id: '', status: '', from: '', to: '' });
                  setPage(1);
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <DataTable
            loading={loading}
            error={error}
            onRetry={refetch}
            rows={records}
            meta={meta}
            onPageChange={setPage}
            emptyTitle="No attendance records"
            emptyMessage="Adjust the filters or mark attendance first."
            columns={[
              { key: 'attendance_date', label: 'Date', render: (row) => <span className="nowrap">{formatDate(row.attendance_date)}</span> },
              {
                key: 'student',
                label: 'Student',
                render: (row) => (
                  <div>
                    <div className="cell-primary">
                      {row.first_name} {row.last_name}
                    </div>
                    <div className="cell-sub mono">{row.admission_number}</div>
                  </div>
                ),
              },
              { key: 'class_name', label: 'Class', render: (row) => `${row.class_name || ''} ${row.section_name || ''}` },
              { key: 'course_name', label: 'Course', render: (row) => row.course_name || 'Daily register' },
              { key: 'period', label: 'Period', render: (row) => (row.period ? `P${row.period}` : 'Full day') },
              { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
              { key: 'marked_by_name', label: 'Marked By', render: (row) => row.marked_by_name || '—' },
            ]}
            mobileColumns={['attendance_date', 'class_name', 'status']}
          />
        </Card>
      )}
    </>
  );
}

export default AttendanceOverview;
