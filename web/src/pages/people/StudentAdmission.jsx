import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useDepartment } from '../../context/DepartmentContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Button, Card, Checkbox, Field, Input, Modal, PageHeader, Select, Textarea,
} from '../../components/ui.jsx';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v }));
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({ value: v, label: v }));
const CATEGORIES = ['GEN', 'OBC', 'SC', 'ST', 'EWS'].map((v) => ({ value: v, label: v }));

/** The school's two departments. Enrolment begins with this choice. */
const DEPARTMENT_CHOICES = [
  {
    value: 'STATE',
    label: 'State Board',
    detail: 'Karnataka State syllabus · Kannada first language',
    icon: 'layers',
    tone: 'tone-blue',
  },
  {
    value: 'CBSE',
    label: 'CBSE',
    detail: 'National curriculum · Hindi first language',
    icon: 'globe',
    tone: 'tone-purple',
  },
];

const empty = {
  first_name: '', last_name: '', date_of_birth: '', gender: '', blood_group: '',
  class_id: '', section_id: '', academic_year_id: '', roll_number: '', mentor_id: '',
  board: '',
  admission_date: new Date().toISOString().slice(0, 10),
  phone: '', email: '', address: '', city: 'Raichur', state: 'Karnataka', pincode: '',
  religion: '', category: '', aadhaar_number: '', previous_school: '',
  create_account: true,
  parent: { father_name: '', mother_name: '', phone: '', email: '', relation: 'FATHER', occupation: '', create_account: true },
};

/**
 * Student admission.
 *
 * Creates the student record, an optional student login, an optional parent
 * record with its own login, the parent link and the enrolment row — the
 * server does all of it in one transaction.
 */
export function StudentAdmission({ basePath = '/administrator' }) {
  const { lookups } = useLookups();
  const dept = useDepartment();
  const toast = useToast();
  const navigate = useNavigate();

  // If a department is already selected in the topbar, start there.
  const [form, setForm] = useState({ ...empty, board: dept.department || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const set = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };
  const setParent = (name, value) =>
    setForm((current) => ({ ...current, parent: { ...current.parent, [name]: value } }));

  // Only the chosen department's classes may be picked, so a student can never
  // be enrolled into the wrong wing.
  const classes = (lookups.classes || []).filter((c) => !form.board || c.board === form.board);
  const sections = (lookups.sections || []).filter(
    (section) =>
      (!form.board || section.board === form.board) &&
      (!form.class_id || String(section.class_id) === String(form.class_id))
  );

  const chooseDepartment = (value) => {
    // Changing wing invalidates any class already picked.
    setForm((current) => ({ ...current, board: value, class_id: '', section_id: '' }));
    setErrors((current) => ({ ...current, board: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.board) {
      setErrors({ board: 'Choose the department this student is joining' });
      toast.error('Department required', 'Select State Board or CBSE before admitting the student.');
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const payload = { ...form };
      for (const key of ['class_id', 'section_id', 'academic_year_id', 'mentor_id']) {
        payload[key] = payload[key] ? Number(payload[key]) : null;
      }
      const result = await api.post('/students', payload);
      setCreated(result.data);
      toast.success('Student admitted', `${result.data.full_name} — ${result.data.admission_number}`);
    } catch (error) {
      setErrors(error.fieldErrors || {});
      toast.fromError(error, 'Admission failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm(empty);
    setCreated(null);
  };

  return (
    <>
      <PageHeader
        title="Student Admission"
        subtitle="Admit a new student, create their login and link a parent account in one step."
        actions={
          <Button icon="arrow-left" onClick={() => navigate(`${basePath}/students`)}>
            Student list
          </Button>
        }
      />

      <form onSubmit={submit}>
        <Card
          title="Department"
          hint="Which wing of the school is this student joining?"
          className="mb-4"
        >
          <div className="child-switcher" style={{ overflowX: 'visible', flexWrap: 'wrap' }}>
            {DEPARTMENT_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={`child-card ${form.board === choice.value ? 'active' : ''}`}
                onClick={() => chooseDepartment(choice.value)}
                style={{ flex: '1 1 260px' }}
              >
                <span className={`stat-icon ${choice.tone}`} style={{ width: 38, height: 38 }}>
                  <Icon name={choice.icon} size={18} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong>{choice.label}</strong>
                  <span>{choice.detail}</span>
                </span>
                {form.board === choice.value && <Icon name="check-circle" size={18} />}
              </button>
            ))}
          </div>
          {errors.board && <div className="field-error mt-2">{errors.board}</div>}
          {form.board && (
            <p className="text-xs text-muted mt-3">
              Classes, sections and the enrolment record below are limited to the{' '}
              <strong>{DEPARTMENT_CHOICES.find((c) => c.value === form.board).label}</strong> department.
            </p>
          )}
        </Card>

        <div className="grid grid-2 mb-4">
          <Card title="Personal information">
            <div className="form-grid">
              <Field label="First name" required error={errors.first_name}>
                <Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
              </Field>
              <Field label="Last name" error={errors.last_name}>
                <Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} options={GENDERS} placeholder="Select..." onChange={(e) => set('gender', e.target.value)} />
              </Field>
              <Field label="Blood group">
                <Select value={form.blood_group} options={BLOOD_GROUPS} placeholder="Select..." onChange={(e) => set('blood_group', e.target.value)} />
              </Field>
              <Field label="Religion">
                <Input value={form.religion} onChange={(e) => set('religion', e.target.value)} />
              </Field>
              <Field label="Category">
                <Select value={form.category} options={CATEGORIES} placeholder="Select..." onChange={(e) => set('category', e.target.value)} />
              </Field>
              <Field label="Aadhaar number">
                <Input value={form.aadhaar_number} onChange={(e) => set('aadhaar_number', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Academic information">
            <div className="form-grid">
              <Field label="Academic year" required>
                <Select
                  value={form.academic_year_id}
                  options={(lookups.academicYears || []).map((y) => ({ value: y.id, label: y.name }))}
                  placeholder="Select..."
                  onChange={(e) => set('academic_year_id', e.target.value)}
                />
              </Field>
              <Field label="Class" required>
                <Select
                  value={form.class_id}
                  options={classes.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={form.board ? 'Select...' : 'Choose a department first'}
                  disabled={!form.board}
                  onChange={(e) => {
                    set('class_id', e.target.value);
                    set('section_id', '');
                  }}
                />
              </Field>
              <Field label="Section" required>
                <Select
                  value={form.section_id}
                  options={sections.map((s) => ({ value: s.id, label: `${s.class_name} — ${s.name}` }))}
                  placeholder={form.class_id ? 'Select...' : 'Choose a class first'}
                  onChange={(e) => set('section_id', e.target.value)}
                  disabled={!form.class_id}
                />
              </Field>
              <Field label="Roll number">
                <Input value={form.roll_number} onChange={(e) => set('roll_number', e.target.value)} />
              </Field>
              <Field label="Mentor">
                <Select
                  value={form.mentor_id}
                  options={(lookups.mentors || []).map((m) => ({ value: m.id, label: m.full_name }))}
                  placeholder="Assign later"
                  onChange={(e) => set('mentor_id', e.target.value)}
                />
              </Field>
              <Field label="Admission date">
                <Input type="date" value={form.admission_date} onChange={(e) => set('admission_date', e.target.value)} />
              </Field>
              <Field label="Previous school" className="span-2">
                <Input value={form.previous_school} onChange={(e) => set('previous_school', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="grid grid-2 mb-4">
          <Card title="Contact information">
            <div className="form-grid">
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Email" error={errors.email}>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Address" className="span-2">
                <Textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
              </Field>
              <Field label="Pincode">
                <Input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="Parent / guardian" hint="A parent account can hold several children">
            <div className="form-grid">
              <Field label="Father's name">
                <Input value={form.parent.father_name} onChange={(e) => setParent('father_name', e.target.value)} />
              </Field>
              <Field label="Mother's name">
                <Input value={form.parent.mother_name} onChange={(e) => setParent('mother_name', e.target.value)} />
              </Field>
              <Field label="Occupation">
                <Input value={form.parent.occupation} onChange={(e) => setParent('occupation', e.target.value)} />
              </Field>
              <Field label="Relation">
                <Select
                  value={form.parent.relation}
                  options={['FATHER', 'MOTHER', 'GUARDIAN'].map((v) => ({ value: v, label: v }))}
                  onChange={(e) => setParent('relation', e.target.value)}
                />
              </Field>
              <Field label="Parent phone">
                <Input value={form.parent.phone} onChange={(e) => setParent('phone', e.target.value)} />
              </Field>
              <Field label="Parent email">
                <Input type="email" value={form.parent.email} onChange={(e) => setParent('email', e.target.value)} />
              </Field>
            </div>

            <div className="form-section">
              <h4>Portal access</h4>
              <div className="stack-sm">
                <Checkbox
                  label="Create a student login for the portal"
                  checked={form.create_account}
                  onChange={(e) => set('create_account', e.target.checked)}
                />
                <Checkbox
                  label="Create a parent login for the portal"
                  checked={form.parent.create_account}
                  onChange={(e) => setParent('create_account', e.target.checked)}
                />
              </div>
              <p className="field-hint mt-3">
                A temporary password is generated and shown once the student is admitted.
              </p>
            </div>
          </Card>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" onClick={reset} disabled={saving}>
            Reset
          </Button>
          <Button type="submit" variant="primary" size="lg" icon="user-plus" loading={saving}>
            Admit student
          </Button>
        </div>
      </form>

      <Modal
        open={!!created}
        onClose={reset}
        title="Student admitted"
        subtitle="Share these details with the family."
        footer={
          <>
            <Button onClick={reset}>Admit another</Button>
            <Button variant="primary" onClick={() => navigate(`${basePath}/students/${created.id}`)}>
              Open profile
            </Button>
          </>
        }
      >
        {created && (
          <div className="stack">
            <div className="row" style={{ gap: 12 }}>
              <span className="stat-icon tone-green" style={{ width: 44, height: 44 }}>
                <Icon name="check-circle" size={22} />
              </span>
              <div>
                <strong style={{ fontSize: 'var(--text-lg)' }}>{created.full_name}</strong>
                <div className="text-muted text-sm">
                  Admission number <span className="mono">{created.admission_number}</span>
                </div>
              </div>
            </div>
            {created.temporaryPassword && (
              <div className="card" style={{ padding: 14, background: 'var(--warning-50)', borderColor: '#fde68a' }}>
                <div className="text-sm fw-600 mb-3">Temporary credentials</div>
                <div className="detail-row">
                  <dt>Username</dt>
                  <dd className="mono">{created.username}</dd>
                </div>
                <div className="detail-row">
                  <dt>Password</dt>
                  <dd className="mono">{created.temporaryPassword}</dd>
                </div>
                <p className="field-hint mt-3">
                  The student must change this password at first sign-in.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export default StudentAdmission;
