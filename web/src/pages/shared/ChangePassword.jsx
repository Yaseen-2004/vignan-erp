import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Button, Card, Field, Input, PageHeader } from '../../components/ui.jsx';

/** Self-service password change. All other sessions are revoked on success. */
export function ChangePassword() {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setErrors({});
    if (form.newPassword !== form.confirmPassword) {
      setErrors({ confirmPassword: 'The two passwords do not match' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success('Password updated', 'Please sign in again with your new password.');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      setErrors(error.fieldErrors || { currentPassword: error.message });
      toast.fromError(error, 'Could not change your password');
    } finally {
      setSaving(false);
    }
  };

  const strength = passwordStrength(form.newPassword);

  return (
    <>
      <PageHeader title="Change Password" subtitle="Choose a strong password you do not use anywhere else." />
      <Card className="mb-4" style={{ maxWidth: 520 }}>
        <form onSubmit={submit}>
          <Field label="Current password" required error={errors.currentPassword}>
            <Input
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
              required
            />
          </Field>
          <Field
            label="New password"
            required
            error={errors.newPassword}
            hint="At least 8 characters, including letters and numbers."
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
              required
            />
          </Field>
          {form.newPassword && (
            <div className="mb-4">
              <div className="progress">
                <div className={`progress-bar ${strength.tone}`} style={{ width: `${strength.percent}%` }} />
              </div>
              <div className="field-hint">Password strength: {strength.label}</div>
            </div>
          )}
          <Field label="Confirm new password" required error={errors.confirmPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })}
              required
            />
          </Field>

          <div className="error-state mt-4" style={{ background: 'var(--info-50)', borderColor: '#bfdbfe', color: 'var(--info-700)' }}>
            <Icon name="info" size={18} />
            <span className="text-sm">Changing your password signs you out of every device.</span>
          </div>

          <Button type="submit" variant="primary" className="btn-block mt-4" icon="key" loading={saving}>
            Update password
          </Button>
        </form>
      </Card>
    </>
  );
}

function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const levels = [
    { label: 'Very weak', tone: 'danger', percent: 20 },
    { label: 'Weak', tone: 'danger', percent: 35 },
    { label: 'Fair', tone: 'warning', percent: 55 },
    { label: 'Good', tone: 'warning', percent: 75 },
    { label: 'Strong', tone: 'success', percent: 90 },
    { label: 'Very strong', tone: 'success', percent: 100 },
  ];
  return levels[score];
}

export default ChangePassword;
