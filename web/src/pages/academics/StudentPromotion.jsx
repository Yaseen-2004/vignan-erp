import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  TableWrap,
  Textarea,
  useFetch,
} from '../../components/ui.jsx';

/**
 * Bulk student promotion.
 *
 * Promoting closes the current enrolment and opens a new one for the target
 * year, so previous academic records stay queryable.
 */
export function StudentPromotion() {
  const { lookups } = useLookups();
  const toast = useToast();

  const [source, setSource] = useState({ class_id: '', section_id: '' });
  const [target, setTarget] = useState({ to_class_id: '', to_section_id: '', to_academic_year_id: '', remarks: '' });
  const [selected, setSelected] = useState(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data: students, loading } = useFetch(
    () => api.get(`/students${qs({ class_id: source.class_id, section_id: source.section_id, status: 'ACTIVE', limit: 200 })}`),
    [source.class_id, source.section_id, nonce],
    { skip: !source.class_id }
  );

  const sourceSections = (lookups.sections || []).filter(
    (section) => !source.class_id || String(section.class_id) === String(source.class_id)
  );
  const targetSections = (lookups.sections || []).filter(
    (section) => !target.to_class_id || String(section.class_id) === String(target.to_class_id)
  );

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === students?.length) setSelected(new Set());
    else setSelected(new Set((students || []).map((student) => student.id)));
  };

  const promote = async () => {
    setBusy(true);
    try {
      const result = await api.post('/students/promote', {
        student_ids: [...selected],
        to_class_id: Number(target.to_class_id),
        to_section_id: Number(target.to_section_id),
        to_academic_year_id: Number(target.to_academic_year_id),
        remarks: target.remarks || undefined,
      });
      toast.success('Students promoted', `${result.data.promoted} student(s) moved to the new class.`);
      setSelected(new Set());
      setConfirming(false);
      setNonce((n) => n + 1);
    } catch (error) {
      toast.fromError(error, 'Promotion failed');
    } finally {
      setBusy(false);
    }
  };

  const ready = target.to_class_id && target.to_section_id && target.to_academic_year_id && selected.size > 0;

  return (
    <>
      <PageHeader
        title="Student Promotion"
        subtitle="Move a batch of students into the next class and academic year. Previous enrolment records are preserved."
      />

      <div className="grid grid-2 mb-4">
        <Card title="1. Choose the current class">
          <div className="form-grid">
            <Field label="Class" required>
              <Select
                value={source.class_id}
                options={(lookups.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Select a class..."
                onChange={(event) => {
                  setSource({ class_id: event.target.value, section_id: '' });
                  setSelected(new Set());
                }}
              />
            </Field>
            <Field label="Section">
              <Select
                value={source.section_id}
                options={sourceSections.map((s) => ({ value: String(s.id), label: `${s.class_name} — ${s.name}` }))}
                placeholder="All sections"
                disabled={!source.class_id}
                onChange={(event) => {
                  setSource({ ...source, section_id: event.target.value });
                  setSelected(new Set());
                }}
              />
            </Field>
          </div>
        </Card>

        <Card title="2. Choose the destination">
          <div className="form-grid">
            <Field label="Academic year" required>
              <Select
                value={target.to_academic_year_id}
                options={(lookups.academicYears || []).map((y) => ({ value: String(y.id), label: y.name }))}
                placeholder="Select a year..."
                onChange={(event) => setTarget({ ...target, to_academic_year_id: event.target.value })}
              />
            </Field>
            <Field label="Class" required>
              <Select
                value={target.to_class_id}
                options={(lookups.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
                placeholder="Select a class..."
                onChange={(event) => setTarget({ ...target, to_class_id: event.target.value, to_section_id: '' })}
              />
            </Field>
            <Field label="Section" required>
              <Select
                value={target.to_section_id}
                options={targetSections.map((s) => ({ value: String(s.id), label: `${s.class_name} — ${s.name}` }))}
                placeholder={target.to_class_id ? 'Select a section...' : 'Choose a class first'}
                disabled={!target.to_class_id}
                onChange={(event) => setTarget({ ...target, to_section_id: event.target.value })}
              />
            </Field>
            <Field label="Remarks" className="span-2">
              <Textarea
                rows={2}
                value={target.remarks}
                placeholder="Recorded against the new enrolment"
                onChange={(event) => setTarget({ ...target, remarks: event.target.value })}
              />
            </Field>
          </div>
        </Card>
      </div>

      {source.class_id && (
        <>
          <div className="grid grid-stats mb-4">
            <Stat label="Students in class" value={students?.length ?? 0} icon="users" tone="navy" />
            <Stat label="Selected for promotion" value={selected.size} icon="check-circle" tone={selected.size ? 'green' : 'neutral'} />
          </div>

          <Card
            title="3. Select students"
            bodyClass="flush"
            actions={
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" onClick={toggleAll}>
                  {selected.size === students?.length ? 'Clear all' : 'Select all'}
                </Button>
                <Button variant="primary" size="sm" icon="trending-up" disabled={!ready} onClick={() => setConfirming(true)}>
                  Promote {selected.size || ''}
                </Button>
              </div>
            }
          >
            {loading ? (
              <div style={{ padding: 16 }}>
                <Skeleton variant="row" count={6} />
              </div>
            ) : !students?.length ? (
              <EmptyState icon="users" title="No active students" message="This class has no active students to promote." />
            ) : (
              <TableWrap>
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>
                        <input
                          type="checkbox"
                          checked={selected.size === students.length && students.length > 0}
                          onChange={toggleAll}
                          style={{ width: 16, height: 16, accentColor: 'var(--navy-600)' }}
                          aria-label="Select all students"
                        />
                      </th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Roll No</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => (
                      <tr
                        key={student.id}
                        onClick={() => toggle(student.id)}
                        style={{ cursor: 'pointer', background: selected.has(student.id) ? 'var(--navy-50)' : undefined }}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(student.id)}
                            onChange={() => toggle(student.id)}
                            style={{ width: 16, height: 16, accentColor: 'var(--navy-600)' }}
                            aria-label={`Select ${student.full_name}`}
                          />
                        </td>
                        <td>
                          <div className="row-person">
                            <Avatar name={student.full_name} src={student.photo} size="sm" />
                            <div style={{ minWidth: 0 }}>
                              <div className="cell-primary truncate">{student.full_name}</div>
                              <div className="cell-sub mono">{student.admission_number}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {student.class_name} {student.section_name}
                        </td>
                        <td>{student.roll_number || '—'}</td>
                        <td>
                          <Badge status={student.status}>{student.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      {!source.class_id && (
        <Card>
          <EmptyState
            icon="trending-up"
            title="Start by choosing a class"
            message="Pick the current class, then the destination class and academic year."
          />
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Promote ${selected.size} student(s)?`}
        message="Their current enrolment will be closed and a new one created for the destination class and academic year. Each student is notified."
        confirmLabel="Promote students"
        variant="primary"
        loading={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={promote}
      />
    </>
  );
}

export default StudentPromotion;
