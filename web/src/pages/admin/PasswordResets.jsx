import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { Icon } from '../../components/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DetailList,
  EmptyState,
  ErrorState,
  Field,
  formatDateTime,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  Textarea,
  timeAgo,
  useDebounced,
  useFetch,
} from '../../components/ui.jsx';

const STATUS = [
  { value: '', label: 'All requests' },
  { value: 'PENDING', label: 'Waiting' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** An Administrator may serve these; an Admin account needs another Admin. */
const ADMINISTRATOR_MAY_RESET = ['STUDENT', 'PARENT', 'TEACHING_STAFF', 'FINANCIAL_STAFF'];

/**
 * The forgotten-password queue.
 *
 * Somebody who cannot sign in raises a request from the login page. Staff work
 * through it here: identify the person, issue a temporary password, and hand it
 * over. The password is shown once, in the confirmation — it is never stored in
 * readable form and the account holder must change it at their next sign-in.
 */
export function PasswordResets() {
  const { role } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const [working, setWorking] = useState(null); // the request being handled
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState(null); // { fullName, username, temporaryPassword }
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/password-resets${qs({ status, search: debounced, page, limit: 20 })}`),
    [status, debounced, page]
  );

  const pendingCount = (data || []).filter((r) => r.status === 'PENDING').length;
  const mayHandle = (row) => role === 'ADMIN' || ADMINISTRATOR_MAY_RESET.includes(row.role_code);

  const open = (row) => {
    setWorking(row);
    setNote('');
    setIssued(null);
    setCopied(false);
  };

  const complete = async () => {
    setBusy(true);
    try {
      const result = await api.post(`/password-resets/${working.id}/complete`, { note: note.trim() || undefined });
      setIssued({
        fullName: result.user.fullName,
        username: result.user.username,
        temporaryPassword: result.temporaryPassword,
      });
      refetch();
    } catch (completeError) {
      toast.error('Could not reset the password', completeError.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await api.post(`/password-resets/${working.id}/reject`, { note: note.trim() || undefined });
      toast.success('Request dismissed', `${working.full_name}'s request was rejected.`);
      setWorking(null);
      refetch();
    } catch (rejectError) {
      toast.error('Could not dismiss the request', rejectError.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the password is on screen regardless.
      setCopied(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Password Resets"
        subtitle="Requests raised from the login page by people who cannot sign in"
        actions={
          <Button variant="secondary" icon="refresh" onClick={refetch}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-stats">
        <Stat
          label="Waiting on this page"
          value={pendingCount}
          icon="clock"
          tone={pendingCount ? 'red' : 'green'}
          meta={pendingCount ? 'Identify the person before resetting' : 'Nothing outstanding'}
        />
        <Stat label="Requests shown" value={meta?.total ?? (data?.length || 0)} icon="key" tone="navy" />
        <Stat
          label="Your authority"
          value={role === 'ADMIN' ? 'All accounts' : 'Staff, students, parents'}
          icon="shield-check"
          tone="blue"
          meta={role === 'ADMIN' ? 'Including Administrators' : 'Admin accounts need an Admin'}
        />
      </div>

      <Card bodyClass="flush">
        <div className="row row-wrap" style={{ gap: 10, padding: 'var(--sp-4)' }}>
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or username"
            style={{ maxWidth: 280 }}
          />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={STATUS}
            style={{ maxWidth: 190 }}
          />
        </div>

        {loading || (!data && !error) ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={5} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data.length ? (
          <EmptyState
            icon="key"
            title="No requests"
            message={
              status === 'PENDING'
                ? 'Nobody is waiting for a password reset.'
                : 'No requests match the current filter.'
            }
          />
        ) : (
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Contact given</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={row.full_name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-primary">{row.full_name}</div>
                          <div className="text-xs text-muted mono">{row.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone="neutral" dot={false}>
                        {row.role_name}
                      </Badge>
                    </td>
                    <td style={{ minWidth: 0 }}>
                      <div className="text-sm">{row.contact || row.phone || '—'}</div>
                      {row.reason && <div className="text-xs text-muted">{row.reason}</div>}
                    </td>
                    <td className="nowrap" title={formatDateTime(row.created_at)}>
                      {timeAgo(row.created_at)}
                    </td>
                    <td>
                      <Badge
                        status={row.status}
                        tone={row.status === 'PENDING' ? 'warning' : row.status === 'COMPLETED' ? 'success' : 'neutral'}
                      >
                        {row.status === 'PENDING' ? 'WAITING' : row.status}
                      </Badge>
                      {row.handled_by_name && (
                        <div className="text-xs text-muted mt-1">by {row.handled_by_name}</div>
                      )}
                    </td>
                    <td className="num">
                      {row.status !== 'PENDING' ? (
                        <span className="text-xs text-muted">{formatDateTime(row.handled_at)}</span>
                      ) : mayHandle(row) ? (
                        <Button size="sm" variant="primary" icon="key" onClick={() => open(row)}>
                          Handle
                        </Button>
                      ) : (
                        <span className="text-xs text-muted" title="Only an Admin can reset this account">
                          Admin only
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        {meta?.pages > 1 && (
          <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onChange={setPage} />
        )}
      </Card>

      <Modal
        open={!!working}
        onClose={() => setWorking(null)}
        title={issued ? 'Temporary password issued' : 'Reset this password'}
        subtitle={working ? `${working.full_name} · ${working.username}` : ''}
      >
        {issued ? (
          <div className="stack-sm">
            <div className="secret-panel">
              <div className="text-xs text-muted fw-700" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Temporary password
              </div>
              <div className="code">{issued.temporaryPassword}</div>
              <Button size="sm" variant="secondary" icon={copied ? 'check' : 'files'} onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-sm text-muted mt-3">
              Write this down or read it out to {issued.fullName}. It is shown only once — it is not stored anywhere in
              readable form. They will be asked to choose a new password the moment they sign in, and every session
              opened with the old password has been signed out.
            </p>
            <Button variant="primary" className="btn-block mt-4" onClick={() => setWorking(null)}>
              Done
            </Button>
          </div>
        ) : (
          working && (
            <>
              <div className="callout callout-warning mb-4">
                <Icon name="alert-triangle" size={16} />
                <span className="text-sm">
                  Confirm who you are speaking to before you reset. Anyone holding the temporary password can sign in
                  as {working.full_name}.
                </span>
              </div>

              <div className="mb-4">
                <DetailList
                  items={[
                    { label: 'Account', value: <span className="mono">{working.username}</span> },
                    { label: 'Role', value: working.role_name },
                    { label: 'Registered telephone', value: working.phone || '—' },
                    { label: 'Telephone given on the form', value: working.contact || '—' },
                    { label: 'Email on file', value: working.email || '—' },
                    { label: 'Requested', value: formatDateTime(working.created_at) },
                  ]}
                />
              </div>

              {working.reason && <p className="text-sm text-muted mb-4">“{working.reason}”</p>}

              <Field label="Note" hint="Recorded in the audit log against this reset">
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Identity confirmed at the office by the father"
                />
              </Field>

              <div className="row" style={{ gap: 10, justifyContent: 'flex-end', marginTop: 'var(--sp-4)' }}>
                <Button variant="secondary" onClick={reject} loading={busy} icon="x-circle">
                  Dismiss request
                </Button>
                <Button variant="primary" onClick={complete} loading={busy} icon="key">
                  Issue temporary password
                </Button>
              </div>
            </>
          )
        )}
      </Modal>
    </div>
  );
}

export default PasswordResets;
