import { useEffect, useState } from 'react';
import { api, qs, download } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useLookups } from '../../hooks/useLookups.js';
import { Icon } from '../../components/Icon.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Skeleton,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

const REPORT_META = {
  students: { icon: 'graduation-cap', tone: 'tone-blue', description: 'Enrolment register with class, section and contact details.' },
  attendance: { icon: 'calendar-check', tone: 'tone-green', description: 'Per-student attendance totals and percentage for a date range.' },
  results: { icon: 'award', tone: 'tone-purple', description: 'Examination results with grade, rank and pass status.' },
  academic: { icon: 'activity', tone: 'tone-navy', description: 'Subject-wise averages, highs and lows per class.' },
  fees: { icon: 'wallet', tone: 'tone-amber', description: 'Billed, discounted, collected and outstanding fees.' },
  payments: { icon: 'receipt', tone: 'tone-teal', description: 'Every collected payment with its receipt number.' },
  payroll: { icon: 'banknote', tone: 'tone-gold', description: 'Payslip register with gross, deductions and net pay.' },
  faculty: { icon: 'briefcase', tone: 'tone-purple', description: 'Staff directory split by teaching and financial category.' },
  transport: { icon: 'bus', tone: 'tone-navy', description: 'Route occupancy with fuel and maintenance costs.' },
  inventory: { icon: 'package', tone: 'tone-teal', description: 'Stock levels, condition and valuation.' },
  administrative: { icon: 'history', tone: 'tone-red', description: 'Audit trail of administrative activity.' },
};

/**
 * Report centre.
 *
 * The API decides which reports this user may run and scopes every row to
 * what they are allowed to see — a student running the attendance report gets
 * only their own attendance.
 */
export function Reports() {
  const { can, user } = useAuth();
  const { lookups } = useLookups();
  const toast = useToast();

  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [exporting, setExporting] = useState(null);

  const { data: available, loading, error, refetch } = useFetch(() => api.get('/reports'), []);

  useEffect(() => {
    setResult(null);
    setFilters({});
  }, [selected]);

  const run = async () => {
    setRunning(true);
    try {
      const response = await api.get(`/reports/${selected.key}${qs({ ...filters, format: 'json' })}`);
      setResult(response.data);
      toast.success('Report generated', `${response.data.rows.length} row(s)`);
    } catch (runError) {
      toast.fromError(runError, 'Could not generate this report');
    } finally {
      setRunning(false);
    }
  };

  const exportAs = async (format) => {
    setExporting(format);
    try {
      await download(
        `/reports/${selected.key}${qs({ ...filters, format })}`,
        `${selected.key}-report-${new Date().toISOString().slice(0, 10)}.${format}`
      );
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch (exportError) {
      toast.fromError(exportError, 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  if (loading) return <LoadingBlock label="Loading available reports" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${available.length} report(s) available to you. Exports honour the same access rules as the screen.`}
      />

      {!selected ? (
        <div className="grid grid-3">
          {available.map((report) => {
            const meta = REPORT_META[report.key] || { icon: 'file-text', tone: 'tone-navy', description: '' };
            return (
              <button
                key={report.key}
                type="button"
                className="card"
                style={{ padding: 18, textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
                onClick={() => setSelected(report)}
              >
                <span className={`stat-icon ${meta.tone}`} style={{ width: 40, height: 40, marginBottom: 12 }}>
                  <Icon name={meta.icon} size={19} />
                </span>
                <strong style={{ display: 'block', fontSize: 'var(--text-md)' }}>{report.title}</strong>
                <p className="text-sm text-muted mt-2">{meta.description}</p>
                <span className="text-xs text-subtle mt-3" style={{ display: 'block' }}>
                  {report.columns.length} columns
                </span>
              </button>
            );
          })}
          {!available.length && (
            <Card>
              <EmptyState icon="bar-chart" title="No reports available" message="Your role does not include report access." />
            </Card>
          )}
        </div>
      ) : (
        <>
          <div className="row mb-4" style={{ gap: 8 }}>
            <Button icon="arrow-left" onClick={() => setSelected(null)}>
              All reports
            </Button>
            <strong className="flex-1" style={{ fontSize: 'var(--text-lg)' }}>
              {selected.title}
            </strong>
          </div>

          <Card title="Filters" className="mb-4">
            <div className="form-grid">
              {['attendance', 'payments', 'administrative'].includes(selected.key) && (
                <>
                  <Field label="From date">
                    <Input type="date" value={filters.from || ''} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                  </Field>
                  <Field label="To date">
                    <Input type="date" value={filters.to || ''} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                  </Field>
                </>
              )}
              {['students', 'attendance', 'results', 'fees', 'academic'].includes(selected.key) && (
                <Field label="Class">
                  <Select
                    value={filters.class_id || ''}
                    options={(lookups.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
                    placeholder="All classes"
                    onChange={(e) => setFilters({ ...filters, class_id: e.target.value })}
                  />
                </Field>
              )}
              {['results', 'academic'].includes(selected.key) && (
                <Field label="Examination">
                  <Select
                    value={filters.examination_id || ''}
                    options={(lookups.examinations || []).map((e) => ({ value: String(e.id), label: e.name }))}
                    placeholder="All examinations"
                    onChange={(e) => setFilters({ ...filters, examination_id: e.target.value })}
                  />
                </Field>
              )}
              {selected.key === 'fees' && (
                <Field label="Status">
                  <Select
                    value={filters.status || ''}
                    options={['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'].map((v) => ({ value: v, label: v }))}
                    placeholder="All statuses"
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  />
                </Field>
              )}
              {selected.key === 'faculty' && (
                <Field label="Category">
                  <Select
                    value={filters.staff_type || ''}
                    options={[
                      { value: 'TEACHING', label: 'Teaching Staff' },
                      { value: 'FINANCIAL', label: 'Financial Staff' },
                    ]}
                    placeholder="Both categories"
                    onChange={(e) => setFilters({ ...filters, staff_type: e.target.value })}
                  />
                </Field>
              )}
              {selected.key === 'payroll' && (
                <>
                  <Field label="Month">
                    <Select
                      value={filters.month || ''}
                      options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                      placeholder="All months"
                      onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                    />
                  </Field>
                  <Field label="Year">
                    <Input
                      type="number"
                      value={filters.year || ''}
                      placeholder={String(new Date().getFullYear())}
                      onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                    />
                  </Field>
                </>
              )}
            </div>

            <div className="row mt-4" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button onClick={() => setFilters({})}>Clear filters</Button>
              <Button variant="primary" icon="activity" onClick={run} loading={running}>
                Generate report
              </Button>
              {can('reports.export') && (
                <>
                  <Button icon="download" onClick={() => exportAs('xlsx')} loading={exporting === 'xlsx'}>
                    Excel
                  </Button>
                  <Button icon="file-text" onClick={() => exportAs('csv')} loading={exporting === 'csv'}>
                    CSV
                  </Button>
                  <Button icon="printer" onClick={() => exportAs('pdf')} loading={exporting === 'pdf'}>
                    PDF
                  </Button>
                </>
              )}
            </div>
          </Card>

          {running ? (
            <Card>
              <Skeleton variant="row" count={8} />
            </Card>
          ) : result ? (
            <Card
              title={result.title}
              hint={`Generated ${result.generatedAt} · ${result.rows.length} row(s)`}
              bodyClass="flush"
            >
              {result.summary && (
                <div className="row row-wrap" style={{ gap: 24, padding: 16, borderBottom: '1px solid var(--border)' }}>
                  {Object.entries(result.summary).map(([label, value]) => (
                    <div key={label}>
                      <div className="stat-label">{label}</div>
                      <strong style={{ fontSize: 'var(--text-lg)' }}>{value}</strong>
                    </div>
                  ))}
                </div>
              )}
              {result.rows.length ? (
                <TableWrap>
                  <table className="data">
                    <thead>
                      <tr>
                        {result.columns.map((column) => (
                          <th key={column.key}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 300).map((row, index) => (
                        <tr key={index}>
                          {result.columns.map((column) => (
                            <td key={column.key}>{row[column.key] ?? '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <EmptyState icon="search" title="No rows matched" message="Try widening the filters." />
              )}
              {result.rows.length > 300 && (
                <div className="pagination">
                  <span>
                    Showing the first 300 of {result.rows.length} rows on screen — export for the complete report.
                  </span>
                </div>
              )}
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon="bar-chart"
                title="Set your filters and generate"
                message="The report runs against live data and respects your access rights."
              />
            </Card>
          )}
        </>
      )}
    </>
  );
}

export default Reports;
