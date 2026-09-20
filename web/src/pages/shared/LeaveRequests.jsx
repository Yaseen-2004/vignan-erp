import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import {
  Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Tabs, Textarea,
  formatDate, useFetch,
} from '../../components/ui.jsx';

const LEAVE_TYPES = ['SICK', 'CASUAL', 'EMERGENCY', 'EARNED', 'OTHER'].map((v) => ({ value: v, label: v }));
const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
];

/**
 * Leave requests.
 *
 * Students and parents raise leave for the student; staff raise their own.
 * Anyone holding `leave.approve` sees the whole queue and can decide.
 */
export function LeaveRequests() {
  const { user, can, children, selectedChildId } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [form, setForm] = useState({
    leave_type: 'SICK',
    from_date: '',
    to_date: '',
    reason: '',
    student_id: selectedChildId ? String(selectedChildId) : '',
  });
  const [review, setReview] = useState({ status: 'APPROVED', review_remarks: '' });
  const [busy, setBusy] = useState(false);

  const canApprove = can('leave.approve');
  const isStudentSide = user.role === 'STUDENT' || user.role === 'PARENT';

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/attendance/leave${qs({ page, limit: 20, status: status === 'ALL' ? '' : status })}`),
    [page, status, nonce]
  );

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const days =
        Math.round((new Date(form.to_date) - new Date(form.from_date)) / 86400000) + 1 || 1;
      await api.post('/attendance/leave', {
        requester_type: isStudentSide ? 'STUDENT' : 'FACULTY',
        student_id: user.role === 'PARENT' ? Number(form.student_id) : undefined,
        leave_type: form.leave_type,
        from_date: form.from_date,
        to_date: form.to_date,
        days,
        reason: form.reason,
      });
      toast.success('Leave request submitted', 'You will be notified once it is reviewed.');
      setCreating(false);
      setForm({ leave_type: 'SICK', from_date: '', to_date: '', reason: '', student_id: selectedChildId ? String(selectedChildId) : '' });
      setNonce((n) => n + 1);
    } catch (submitError) {
      toast.fromError(submitError, 'Could not submit this request');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/attendance/leave/${reviewing.id}/review`, {
        status: decision,
        review_remarks: review.review_remarks || undefined,
      });
      toast.success(`Leave ${decision.toLowerCase()}`, 'The requester has been notified.');
      setReviewing(null);
      setReview({ status: 'APPROVED', review_remarks: '' });
      setNonce((n) => n + 1);
    } catch (decideError) {
      toast.fromError(decideError, 'Could not complete the review');
    } finally {
      setBusy(false);
    }
  };

  const counts = (data || []).reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});

  return (
    <>
      <PageHeader
        title="Leave Requests"
        subtitle={canApprove ? 'Review and decide leave requests from students and staff.' : 'Raise a leave request and track its status.'}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Request leave
          </Button>
        }
      />

      {canApprove && (
        <div className="grid grid-stats mb-4">
          <Stat label="Pending" value={counts.PENDING || 0} icon="clock" tone="amber" />
          <Stat label="Approved" value={counts.APPROVED || 0} icon="check-circle" tone="green" />
          <Stat label="Rejected" value={counts.REJECTED || 0} icon="x-circle" tone="red" />
        </div>
      )}

      <Tabs
        tabs={STATUS_TABS}
        active={status}
        onChange={(next) => {
          setStatus(next);
          setPage(1);
        }}
        pill
      />

      <Card bodyClass="flush" className="mt-4">
        <DataTable
          loading={loading}
          error={error}
          onRetry={refetch}
          rows={data}
          meta={meta}
          onPageChange={setPage}
          emptyTitle="No leave requests"
          emptyMessage={canApprove ? 'Nothing is waiting for your decision.' : 'You have not raised any leave requests yet.'}
          columns={[
            {
              key: 'requester',
              label: 'Requester',
              render: (row) => (
                <div>
                  <div className="cell-primary">
                    {row.requester_type === 'STUDENT'
                      ? `${row.student_first_name || ''} ${row.student_last_name || ''}`.trim() || '—'
                      : row.faculty_name || '—'}
                  </div>
                  <div className="cell-sub mono">
                    {row.admission_number || row.faculty_code || row.requester_type}
                  </div>
                </div>
              ),
            },
            {
              key: 'class_name',
              label: 'Class',
              render: (row) => (row.class_name ? `${row.class_name} ${row.section_name || ''}` : '—'),
            },
            { key: 'leave_type', label: 'Type', render: (row) => <Badge tone="neutral" dot={false}>{row.leave_type}</Badge> },
            { key: 'from_date', label: 'From', sortable: true, render: (row) => formatDate(row.from_date) },
            { key: 'to_date', label: 'To', render: (row) => formatDate(row.to_date) },
            { key: 'days', label: 'Days', numeric: true },
            { key: 'reason', label: 'Reason', render: (row) => <span className="truncate">{row.reason}</span> },
            { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
          ]}
          mobileColumns={['leave_type', 'from_date', 'to_date', 'status']}
          rowActions={
            canApprove
              ? (row) =>
                  row.status === 'PENDING' ? (
                    <Button size="sm" variant="primary" onClick={() => setReviewing(row)}>
                      Review
                    </Button>
                  ) : (
                    <span className="text-xs text-muted">{row.reviewed_by_name || '—'}</span>
                  )
              : undefined
          }
        />
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Request leave"
        footer={
          <>
            <Button onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon="send" onClick={submit} loading={busy}>
              Submit request
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          {user.role === 'PARENT' && children.length > 1 && (
            <Field label="Child" required>
              <Select
                value={form.student_id}
                options={children.map((child) => ({
                  value: String(child.id),
                  label: `${child.first_name} ${child.last_name || ''} — ${child.class_name} ${child.section_name}`,
                }))}
                placeholder="Select a child..."
                onChange={(event) => setForm({ ...form, student_id: event.target.value })}
                required
              />
            </Field>
          )}
          <div className="form-grid">
            <Field label="Leave type" required>
              <Select
                value={form.leave_type}
                options={LEAVE_TYPES}
                onChange={(event) => setForm({ ...form, leave_type: event.target.value })}
              />
            </Field>
            <Field label="From date" required>
              <Input
                type="date"
                value={form.from_date}
                onChange={(event) => setForm({ ...form, from_date: event.target.value, to_date: form.to_date || event.target.value })}
                required
              />
            </Field>
            <Field label="To date" required>
              <Input
                type="date"
                min={form.from_date}
                value={form.to_date}
                onChange={(event) => setForm({ ...form, to_date: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Reason" required>
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              placeholder="Explain why leave is needed"
              required
            />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Review leave request"
        subtitle={reviewing ? `${formatDate(reviewing.from_date)} — ${formatDate(reviewing.to_date)} (${reviewing.days} day(s))` : ''}
        footer={
          <>
            <Button onClick={() => setReviewing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" icon="x-circle" onClick={() => decide('REJECTED')} loading={busy}>
              Reject
            </Button>
            <Button variant="success" icon="check-circle" onClick={() => decide('APPROVED')} loading={busy}>
              Approve
            </Button>
          </>
        }
      >
        {reviewing && (
          <div className="stack">
            <div className="card" style={{ padding: 14, background: 'var(--ink-50)' }}>
              <div className="detail-row">
                <dt>Requester</dt>
                <dd>
                  {reviewing.requester_type === 'STUDENT'
                    ? `${reviewing.student_first_name || ''} ${reviewing.student_last_name || ''}`
                    : reviewing.faculty_name}
                </dd>
              </div>
              <div className="detail-row">
                <dt>Type</dt>
                <dd>{reviewing.leave_type}</dd>
              </div>
              <div className="detail-row">
                <dt>Reason</dt>
                <dd>{reviewing.reason}</dd>
              </div>
            </div>
            <Field label="Remarks" hint="Shown to the requester">
              <Textarea
                rows={2}
                value={review.review_remarks}
                onChange={(event) => setReview({ ...review, review_remarks: event.target.value })}
              />
            </Field>
            <p className="field-hint">
              <Icon name="info" size={13} /> Approving a student leave marks those days as leave in the attendance register.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

export default LeaveRequests;
