import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formatNumber,
  Input,
  LoadingBlock,
  Meter,
  Modal,
  PageHeader,
  Select,
  Stat,
  TableWrap,
  useFetch,
} from '../../components/ui.jsx';

/**
 * Bytes in the largest unit that keeps the number readable.
 *
 * A limit set in megabytes can be a terabyte, and "1048576.0 MB" tells nobody
 * anything — so the unit follows the size rather than being fixed.
 */
const size = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
};

const AGES = [
  { value: '90', label: 'older than 3 months' },
  { value: '180', label: 'older than 6 months' },
  { value: '365', label: 'older than 1 year' },
  { value: '730', label: 'older than 2 years' },
  { value: '1095', label: 'older than 3 years' },
];

/**
 * Data & Storage — Admin only.
 *
 * Shows how much the school is holding against the limit the Admin sets, and
 * lets them clear what is no longer needed. Every purge shows its row count
 * before it runs and has to be confirmed by typing CLEAR, because none of it
 * can be undone.
 */
export function DataStorage() {
  const toast = useToast();
  const [days, setDays] = useState('365');
  const [picked, setPicked] = useState([]);
  const [confirm, setConfirm] = useState('');
  const [year, setYear] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data, loading, error, refetch } = useFetch(() => api.get('/storage'), [nonce]);
  const { data: purges } = useFetch(
    () => api.get(`/storage/purges${qs({ older_than_days: days })}`),
    [days, nonce]
  );

  const reload = () => setNonce((n) => n + 1);
  const selectable = (purges?.options || []).filter((option) => option.rows > 0);
  const totalRows = selectable
    .filter((option) => picked.includes(option.key))
    .reduce((sum, option) => sum + option.rows, 0);

  const runPurge = async () => {
    setBusy(true);
    try {
      const result = await api.post('/storage/purge', {
        keys: picked,
        older_than_days: Number(days),
        confirm: 'CLEAR',
      });
      toast.success(
        `${formatNumber(result.total)} record(s) cleared`,
        `The database is now ${size(result.sizeAfter)}.`
      );
      setPicked([]);
      setConfirm('');
      reload();
    } catch (purgeError) {
      toast.error('Could not clear the data', purgeError.message);
    } finally {
      setBusy(false);
    }
  };

  const runYearPurge = async () => {
    setBusy(true);
    try {
      const result = await api.post('/storage/purge-year', { academic_year_id: year.id, confirm: 'CLEAR' });
      const removed = Object.values(result.removed).reduce((sum, n) => sum + n, 0);
      toast.success(`${result.year} cleared`, `${formatNumber(removed)} record(s) removed.`);
      setYear(null);
      setConfirm('');
      reload();
    } catch (purgeError) {
      toast.error('Could not clear that year', purgeError.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Measuring stored data" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const tone = data.state === 'FULL' ? 'red' : data.state === 'NEAR' ? 'gold' : 'green';

  return (
    <div className="stack">
      <PageHeader
        title="Data & Storage"
        subtitle="What the school is holding, against the limit you have set — and what can safely be cleared."
        actions={<Button variant="secondary" icon="refresh" onClick={reload}>Refresh</Button>}
      />

      {data.state !== 'OK' && (
        <div className={`callout callout-${data.state === 'FULL' ? 'warning' : 'warning'}`}>
          <Icon name="alert-triangle" size={16} />
          <span className="text-sm">
            {data.state === 'FULL'
              ? `Storage is full — ${size(data.used)} of ${size(data.limit)}. Clear old records below, or raise the limit in System Settings.`
              : `Storage is at ${data.percent}% of the ${size(data.limit)} limit. Consider clearing old records.`}
          </span>
        </div>
      )}

      <Card>
        <div className="grid grid-stats">
          <Stat label="Database" value={size(data.database)} icon="grid" tone="navy" />
          <Stat label="Uploaded files" value={size(data.uploads)} icon="files" tone="blue" />
          <Stat label="Total used" value={size(data.used)} icon="package" tone={tone} meta={`${data.percent}% of limit`} />
          <Stat label="Limit" value={size(data.limit)} icon="sliders" tone="navy" meta="Set in System Settings" />
        </div>
        <div className="mt-5">
          {/* Meter prints the raw value, so it is fed the percentage, not bytes. */}
          <Meter
            label={`${size(data.used)} of ${size(data.limit)}`}
            value={data.percent}
            max={100}
            tone={data.state === 'OK' ? 'success' : data.state === 'NEAR' ? 'warning' : 'danger'}
          />
        </div>
      </Card>

      <Card title="What is taking the space" hint="Row counts for the tables that grow" bodyClass="flush">
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Records</th>
                <th className="mono">Table</th>
                <th className="num">Rows</th>
              </tr>
            </thead>
            <tbody>
              {data.tables.map((row) => (
                <tr key={row.table}>
                  <td className="cell-primary">{row.label}</td>
                  <td className="text-xs text-muted mono">{row.table}</td>
                  <td className="num">{formatNumber(row.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {/* ------------------------------------------------- clear old data */}
      <Card
        title="Clear previous data"
        hint="Only logs, read notifications, expired sessions and old messages. Pupils, staff, fees and results are never touched."
      >
        <div className="row row-wrap mb-4" style={{ gap: 10, alignItems: 'flex-end' }}>
          <Field label="Clear records" className="mb-0">
            <Select value={days} onChange={(event) => setDays(event.target.value)} options={AGES} style={{ maxWidth: 220 }} />
          </Field>
        </div>

        {!selectable.length ? (
          <EmptyState
            icon="check-circle"
            title="Nothing to clear"
            message={`No records are ${AGES.find((a) => a.value === days)?.label}.`}
          />
        ) : (
          <div className="pick-list">
            {selectable.map((option) => {
              const on = picked.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`pick-row${on ? ' on' : ''}`}
                  onClick={() =>
                    setPicked((current) =>
                      on ? current.filter((k) => k !== option.key) : [...current, option.key]
                    )
                  }
                >
                  <span className={`tick${on ? ' on' : ''}`}>{on && <Icon name="check" size={12} />}</span>
                  <span className="label">
                    <strong>{option.label}</strong>
                    <span>{formatNumber(option.rows)} records</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {picked.length > 0 && (
          <div className="callout callout-warning mt-4">
            <Icon name="alert-triangle" size={16} />
            <div style={{ minWidth: 0 }}>
              <strong className="text-sm">
                {formatNumber(totalRows)} record(s) will be permanently deleted.
              </strong>
              <div className="row row-wrap mt-3" style={{ gap: 10, alignItems: 'center' }}>
                <Input
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="Type CLEAR to confirm"
                  style={{ maxWidth: 200 }}
                />
                <Button
                  variant="danger"
                  icon="trash"
                  loading={busy}
                  disabled={confirm !== 'CLEAR'}
                  onClick={runPurge}
                >
                  Clear {formatNumber(totalRows)} records
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* --------------------------------------------- clear a whole year */}
      <Card
        title="Clear a past academic year"
        hint="Removes that year's timetable, course assignments, enrolments, examinations and marks. The current year cannot be cleared."
        bodyClass="flush"
      >
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Academic year</th>
                <th className="num">Enrolments</th>
                <th className="num">Timetable</th>
                <th className="num">Examinations</th>
                <th className="num">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="cell-primary">{row.name}</span>
                    {!!row.is_current && (
                      <Badge tone="success" dot={false}>
                        Current
                      </Badge>
                    )}
                  </td>
                  <td className="num">{formatNumber(row.enrollments)}</td>
                  <td className="num">{formatNumber(row.timetable_slots)}</td>
                  <td className="num">{formatNumber(row.examinations)}</td>
                  <td className="num">
                    {row.is_current ? (
                      <span className="text-xs text-muted">In use</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => {
                          setYear(row);
                          setConfirm('');
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Modal
        open={!!year}
        onClose={() => setYear(null)}
        title={`Clear ${year?.name}?`}
        subtitle="This cannot be undone"
      >
        {year && (
          <>
            <div className="callout callout-warning mb-4">
              <Icon name="alert-triangle" size={16} />
              <span className="text-sm">
                {formatNumber(year.enrollments)} enrolments, {formatNumber(year.timetable_slots)} timetable slots and{' '}
                {formatNumber(year.examinations)} examinations — with their marks and results — will be permanently
                deleted. Pupils, staff and fee records are not touched.
              </span>
            </div>
            <Field label="Type CLEAR to confirm">
              <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="CLEAR" />
            </Field>
            <div className="row mt-4" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setYear(null)}>
                Cancel
              </Button>
              <Button variant="danger" icon="trash" loading={busy} disabled={confirm !== 'CLEAR'} onClick={runYearPurge}>
                Clear {year.name}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default DataStorage;
