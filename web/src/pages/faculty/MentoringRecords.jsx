import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal,
  PageHeader, Select, Skeleton, Tabs, Textarea, Checkbox, formatDate, useFetch,
} from '../../components/ui.jsx';

const TYPES = ['GUIDANCE', 'MEETING', 'REMARK', 'ACHIEVEMENT', 'CONCERN'];
const TYPE_OPTIONS = TYPES.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));
const TABS = [{ key: 'ALL', label: 'All' }, ...TYPE_OPTIONS.map((t) => ({ key: t.value, label: t.label }))];

const TYPE_TONE = {
  GUIDANCE: 'info',
  MEETING: 'neutral',
  REMARK: 'purple',
  ACHIEVEMENT: 'success',
  CONCERN: 'danger',
};
const TYPE_ICON = {
  GUIDANCE: 'compass',
  MEETING: 'calendar',
  REMARK: 'file-text',
  ACHIEVEMENT: 'award',
  CONCERN: 'alert-triangle',
};

const emptyForm = {
  student_id: '',
  record_type: 'GUIDANCE',
  title: '',
  notes: '',
  meeting_date: new Date().toISOString().slice(0, 10),
  follow_up_date: '',
  action_items: '',
  visible_to_parent: true,
};

/**
 * Mentoring records for a teacher.
 *
 * Records are written against your own mentees — the student picker offers
 * only them, and the API refuses anyone else. Parents see a record only when
 * it is marked visible to them.
 */
export function MentoringRecords() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [type, setType] = useState('ALL');
  const [studentFilter, setStudentFilter] = useState(params.get('student_id') || '');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data: mentees } = useFetch(() => api.get('/mentoring/mentees/list'), []);

  const { data, loading, error, refetch } = useFetch(
    () =>
      api.get(
        `/mentoring${qs({
          record_type: type === 'ALL' ? '' : type,
          student_id: studentFilter,
          limit: 100,
          sort: 'created_at',
          order: 'desc',
        })}`
      ),
    [type, studentFilter, nonce]
  );

  const menteeOptions = useMemo(
    () =>
      (mentees || []).map((m) => ({
        value: m.id,
        label: `${m.first_name} ${m.last_name || ''} — ${m.class_name || ''} ${m.section_name || ''}`.trim(),
      })),
    [mentees]
  );

  // A deep link from My Mentees opens the form on that student.
  useEffect(() => {
    if (params.get('new') === '1' && mentees) {
      setForm({ ...emptyForm, student_id: params.get('student_id') || '' });
      setEditing(null);
      setErrors({});
      setOpen(true);
      setParams({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, mentees]);

  const set = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const openCreate = () => {
    setForm({ ...emptyForm, student_id: studentFilter || '' });
    setEditing(null);
    setErrors({});
    setOpen(true);
  };

  const openEdit = (record) => {
    setForm({
      student_id: record.student_id,
      record_type: record.record_type,
      title: record.title ?? '',
      notes: record.notes ?? '',
      meeting_date: record.meeting_date ?? '',
      follow_up_date: record.follow_up_date ?? '',
      action_items: record.action_items ?? '',
      visible_to_parent: !!record.visible_to_parent,
    });
    setEditing(record);
    setErrors({});
    setOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    const problems = {};
    if (!form.student_id) problems.student_id = 'Choose one of your mentees';
    if (!form.title.trim()) problems.title = 'Give the record a title';
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        student_id: Number(form.student_id),
        record_type: form.record_type,
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        meeting_date: form.meeting_date || null,
        follow_up_date: form.follow_up_date || null,
        action_items: form.action_items.trim() || null,
        visible_to_parent: form.visible_to_parent ? 1 : 0,
      };
      if (editing) await api.put(`/mentoring/${editing.id}`, payload);
      else await api.post('/mentoring', payload);

      toast.success(editing ? 'Record updated' : 'Record added', form.title.trim());
      setOpen(false);
      setNonce((n) => n + 1);
    } catch (saveError) {
      setErrors(saveError.fieldErrors || {});
      toast.fromError(saveError, 'Could not save this record');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/mentoring/${deleting.id}`);
      toast.success('Record removed');
      setDeleting(null);
      setNonce((n) => n + 1);
    } catch (deleteError) {
      toast.fromError(deleteError, 'Could not remove this record');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Mentoring Records"
        subtitle="Guidance, meetings, remarks and concerns for the students you mentor."
        actions={
          <>
            <Link to="/faculty/teaching/mentees" className="btn btn-secondary">
              <Icon name="compass" size={15} /> My Mentees
            </Link>
            <Button variant="primary" icon="plus" onClick={openCreate} disabled={!menteeOptions.length}>
              Add record
            </Button>
          </>
        }
      />

      {!menteeOptions.length && (
        <Card className="mb-4">
          <EmptyState
            icon="compass"
            title="No mentees assigned to you"
            message="Records are written against your own mentees. Ask the Administrator to assign some."
          />
        </Card>
      )}

      <Tabs tabs={TABS} active={type} onChange={setType} pill />

      <Card bodyClass="flush" className="mt-4">
        <div className="toolbar">
          <Select
            className="compact"
            value={studentFilter}
            placeholder="All my mentees"
            options={menteeOptions}
            onChange={(event) => setStudentFilter(event.target.value)}
          />
          {studentFilter && (
            <Button size="sm" variant="ghost" icon="x" onClick={() => setStudentFilter('')}>
              Clear
            </Button>
          )}
          <div className="toolbar-spacer" />
          <span className="text-sm text-muted">{data?.length ?? 0} record(s)</span>
          <Button size="sm" variant="ghost" icon="refresh" onClick={refetch} aria-label="Refresh" />
        </div>

        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={5} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon="compass"
            title="Nothing recorded yet"
            message="Log a guidance session, a meeting, an achievement or a concern for one of your mentees."
            action={
              menteeOptions.length ? (
                <Button variant="primary" icon="plus" onClick={openCreate}>
                  Add record
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="feed">
            {data.map((record) => (
              <div className="feed-item" key={record.id}>
                <span className={`feed-icon tone-${TYPE_TONE[record.record_type] === 'danger' ? 'red' : TYPE_TONE[record.record_type] === 'success' ? 'green' : TYPE_TONE[record.record_type] === 'purple' ? 'purple' : 'navy'}`}>
                  <Icon name={TYPE_ICON[record.record_type] || 'compass'} size={15} />
                </span>

                <div className="feed-body">
                  <strong>{record.title}</strong>
                  {record.notes && <p>{record.notes}</p>}
                  {record.action_items && (
                    <p className="text-xs" style={{ color: 'var(--navy-600)' }}>
                      <Icon name="target" size={12} /> {record.action_items}
                    </p>
                  )}
                  <span className="feed-time">
                    <Link to={`/faculty/teaching/students/${record.student_id}`}>
                      {record.first_name} {record.last_name}
                    </Link>{' '}
                    · {record.class_name} {record.section_name} ·{' '}
                    {formatDate(record.meeting_date || record.created_at)}
                    {record.follow_up_date ? ` · follow-up ${formatDate(record.follow_up_date)}` : ''}
                  </span>
                </div>

                <Badge tone={TYPE_TONE[record.record_type]} dot={false}>
                  {record.record_type.charAt(0) + record.record_type.slice(1).toLowerCase()}
                </Badge>
                {!record.visible_to_parent && (
                  <Badge tone="neutral" dot={false}>
                    Private
                  </Badge>
                )}

                <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(record)} aria-label="Edit" />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    style={{ color: 'var(--danger-700)' }}
                    onClick={() => setDeleting(record)}
                    aria-label="Delete"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="wide"
        title={editing ? 'Edit mentoring record' : 'Add mentoring record'}
        subtitle={editing ? `Record #${editing.id}` : 'Visible to the student, and to the parent unless you mark it private.'}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="save" onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Add record'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Mentee" required error={errors.student_id}>
              <Select
                value={form.student_id}
                placeholder="Choose one of your mentees"
                options={menteeOptions}
                disabled={!!editing}
                onChange={(event) => set('student_id', event.target.value)}
              />
            </Field>

            <Field label="Type">
              <Select
                value={form.record_type}
                options={TYPE_OPTIONS}
                onChange={(event) => set('record_type', event.target.value)}
              />
            </Field>

            <Field label="Title" required error={errors.title} className="span-2">
              <Input
                value={form.title}
                placeholder="Monthly mentoring meeting"
                onChange={(event) => set('title', event.target.value)}
              />
            </Field>

            <Field label="Notes" className="span-2">
              <Textarea
                rows={4}
                value={form.notes}
                placeholder="What was discussed, and how the student is progressing."
                onChange={(event) => set('notes', event.target.value)}
              />
            </Field>

            <Field label="Meeting date">
              <Input type="date" value={form.meeting_date} onChange={(event) => set('meeting_date', event.target.value)} />
            </Field>

            <Field label="Follow-up date">
              <Input
                type="date"
                value={form.follow_up_date}
                onChange={(event) => set('follow_up_date', event.target.value)}
              />
            </Field>

            <Field label="Action items" className="span-2">
              <Input
                value={form.action_items}
                placeholder="Weekly revision plan, parent meeting, remedial class..."
                onChange={(event) => set('action_items', event.target.value)}
              />
            </Field>

            <Field className="span-2">
              <Checkbox
                label="Visible to the parent"
                checked={form.visible_to_parent}
                onChange={(event) => set('visible_to_parent', event.target.checked)}
              />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this record?"
        message={`"${deleting?.title}" will be removed from the student's mentoring history.`}
        confirmLabel="Remove"
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}

export default MentoringRecords;
