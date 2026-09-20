import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import {
  Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat,
  formatDateTime, useDebounced, useFetch,
} from '../../components/ui.jsx';

const ACTION_TONE = {
  LOGIN: 'info', LOGOUT: 'neutral', CREATE: 'success', UPDATE: 'info', DELETE: 'danger',
  APPROVE: 'success', REJECT: 'danger', PUBLISH: 'success', UNPUBLISH: 'warning',
  PERMISSION_CHANGE: 'purple', ROLE_CHANGE: 'purple', SYSTEM_CHANGE: 'warning',
  PASSWORD_CHANGE: 'warning', PASSWORD_RESET: 'warning', FEE_PAYMENT: 'success',
  MARKS_UPDATE: 'info', ATTENDANCE_UPDATE: 'info', EXPORT: 'neutral',
  ACTIVATE: 'success', DEACTIVATE: 'danger', PROMOTE: 'success',
};

/**
 * Audit log viewer.
 *
 * Every important action is recorded with the acting user, role, timestamp and
 * — for changes — the old and new values.
 */
export function AuditLogs() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ action: '', module: '', role_code: '', from: '', to: '' });
  const [viewing, setViewing] = useState(null);

  const debounced = useDebounced(search);
  const { data: filterOptions } = useFetch(() => api.get('/system/audit-logs/filters'), []);
  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/system/audit-logs${qs({ page, limit: 30, search: debounced, ...filters })}`),
    [page, debounced, filters]
  );

  const clear = () => {
    setFilters({ action: '', module: '', role_code: '', from: '', to: '' });
    setSearch('');
    setPage(1);
  };

  const anyFilter = Object.values(filters).some(Boolean) || search;

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Logins, record changes, approvals, publications, fee payments and permission changes."
        actions={<Button icon="refresh" onClick={refetch}>Refresh</Button>}
      />

      <div className="grid grid-stats mb-4">
        <Stat label="Entries shown" value={meta?.total?.toLocaleString() ?? '—'} icon="history" tone="navy" />
        <Stat label="Actions tracked" value={filterOptions?.actions?.length ?? '—'} icon="activity" tone="blue" />
        <Stat label="Modules" value={filterOptions?.modules?.length ?? '—'} icon="layers" tone="purple" />
      </div>

      <Card bodyClass="flush">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={15} />
            <Input
              placeholder="Search description, user or action..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            className="compact"
            value={filters.action}
            options={(filterOptions?.actions || []).map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))}
            placeholder="All actions"
            onChange={(event) => {
              setFilters({ ...filters, action: event.target.value });
              setPage(1);
            }}
          />
          <Select
            className="compact"
            value={filters.module}
            options={(filterOptions?.modules || []).map((m) => ({ value: m, label: m }))}
            placeholder="All modules"
            onChange={(event) => {
              setFilters({ ...filters, module: event.target.value });
              setPage(1);
            }}
          />
          <Select
            className="compact"
            value={filters.role_code}
            options={(filterOptions?.roles || []).map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
            placeholder="All roles"
            onChange={(event) => {
              setFilters({ ...filters, role_code: event.target.value });
              setPage(1);
            }}
          />
          <Input
            type="date"
            style={{ width: 150 }}
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
          <Input
            type="date"
            style={{ width: 150 }}
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
          {anyFilter && (
            <Button size="sm" variant="ghost" icon="x" onClick={clear}>
              Clear
            </Button>
          )}
        </div>

        <DataTable
          loading={loading}
          error={error}
          onRetry={refetch}
          rows={data}
          meta={meta}
          onPageChange={setPage}
          onRowClick={setViewing}
          emptyTitle="No log entries"
          emptyMessage="Adjust the filters to see more activity."
          columns={[
            {
              key: 'created_at',
              label: 'Timestamp',
              render: (row) => <span className="nowrap text-muted">{formatDateTime(row.created_at)}</span>,
            },
            {
              key: 'user_name',
              label: 'User',
              render: (row) => (
                <div>
                  <div className="cell-primary">{row.user_name || 'System'}</div>
                  <div className="cell-sub mono">{row.username || '—'}</div>
                </div>
              ),
            },
            {
              key: 'role_code',
              label: 'Role',
              render: (row) => (
                <Badge tone="neutral" dot={false}>
                  {row.role_code?.replace(/_/g, ' ') || '—'}
                </Badge>
              ),
            },
            {
              key: 'action',
              label: 'Action',
              badge: true,
              render: (row) => (
                <Badge tone={ACTION_TONE[row.action] || 'neutral'} dot={false}>
                  {row.action.replace(/_/g, ' ')}
                </Badge>
              ),
            },
            { key: 'module', label: 'Module', render: (row) => row.module || '—' },
            { key: 'description', label: 'Description', render: (row) => <span className="truncate">{row.description}</span> },
            {
              key: 'status',
              label: 'Result',
              render: (row) => (
                <Badge tone={row.status === 'FAILED' ? 'danger' : 'success'} dot={false}>
                  {row.status}
                </Badge>
              ),
            },
          ]}
          mobileColumns={['user_name', 'action', 'module', 'created_at']}
        />
      </Card>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Audit entry"
        subtitle={viewing ? formatDateTime(viewing.created_at) : ''}
        size="wide"
        footer={<Button onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <div className="stack">
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="card" style={{ padding: 14 }}>
                <div className="stat-label">User</div>
                <strong>{viewing.user_name || 'System'}</strong>
                <div className="text-xs text-muted">
                  {viewing.role_code} · {viewing.username || 'n/a'}
                </div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="stat-label">Action</div>
                <strong>{viewing.action.replace(/_/g, ' ')}</strong>
                <div className="text-xs text-muted">
                  {viewing.module} {viewing.entity_type ? `· ${viewing.entity_type} #${viewing.entity_id ?? ''}` : ''}
                </div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="stat-label">Date &amp; time</div>
                <strong>{formatDateTime(viewing.created_at)}</strong>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div className="stat-label">Origin</div>
                <strong className="mono text-sm">{viewing.ip_address || '—'}</strong>
                <div className="text-xs text-muted truncate">{viewing.user_agent || ''}</div>
              </div>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="stat-label">Description</div>
              <p>{viewing.description}</p>
            </div>

            {(viewing.old_values || viewing.new_values) && (
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="card" style={{ padding: 14, background: 'var(--danger-50)', borderColor: '#fecaca' }}>
                  <div className="stat-label">Old values</div>
                  <pre className="mono text-xs" style={{ whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto' }}>
                    {viewing.old_values ? JSON.stringify(viewing.old_values, null, 2) : '—'}
                  </pre>
                </div>
                <div className="card" style={{ padding: 14, background: 'var(--success-50)', borderColor: '#bbf7d0' }}>
                  <div className="stat-label">New values</div>
                  <pre className="mono text-xs" style={{ whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto' }}>
                    {viewing.new_values ? JSON.stringify(viewing.new_values, null, 2) : '—'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export default AuditLogs;
