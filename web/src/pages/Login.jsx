import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api/client.js';
import { Icon } from '../components/Icon.jsx';
import { Button, Field, Input, Modal, Textarea } from '../components/ui.jsx';
import '../styles/auth.css';

import { readChoice, writeSetting } from '../lib/storage.js';
/**
 * The four doors into the system — the four top-level sections of the
 * specification. Choosing one narrows who may sign in: the API refuses an
 * account whose role does not belong to the chosen portal, so this is a real
 * gate and not merely a label on the form.
 */
const PORTALS = [
  {
    id: 'PARENTS',
    label: 'Parents',
    short: 'Parent',
    icon: 'users',
    hint: "Your child's attendance, results, materials, fees and mentor — switch between children if you have more than one.",
    placeholder: 'e.g. pvgn20250248',
    roles: ['PARENT'],
  },
  {
    id: 'FACULTY',
    label: 'Faculty',
    short: 'Faculty',
    icon: 'briefcase',
    hint: 'Teaching staff and financial staff.',
    placeholder: 'e.g. girish',
    roles: ['TEACHING_STAFF', 'FINANCIAL_STAFF'],
  },
  {
    id: 'ADMINISTRATOR',
    label: 'Administrator',
    short: 'Administrator',
    icon: 'user-cog',
    hint: 'Admissions, academics, examinations and staff records.',
    placeholder: 'e.g. shobha',
    roles: ['ADMINISTRATOR'],
  },
  {
    id: 'ADMIN',
    label: 'Admin',
    short: 'Admin',
    icon: 'shield-check',
    hint: 'Complete control of the software and its settings.',
    placeholder: 'e.g. admin',
    roles: ['ADMIN'],
  },
];

/** Which door a demo account belongs to, so picking one selects its portal. */
const portalForRole = (role) => PORTALS.find((portal) => portal.roles.includes(role))?.id ?? 'PARENTS';

const DEMO_ACCOUNTS = [
  { role: 'Admin', username: 'admin', code: 'ADMIN', note: 'Complete software control' },
  { role: 'Administrator', username: 'shobha', code: 'ADMINISTRATOR', note: 'Students & faculty' },
  { role: 'Administrator (restricted)', username: 'mallikarjun', code: 'ADMINISTRATOR', note: 'Reduced permissions' },
  { role: 'Teaching Staff (State)', username: 'basavaraj', code: 'TEACHING_STAFF', note: 'State wing only' },
  { role: 'Teaching Staff (CBSE)', username: 'girish', code: 'TEACHING_STAFF', note: 'CBSE wing only' },
  { role: 'Financial Staff', username: 'gurunath', code: 'FINANCIAL_STAFF', note: 'Fees & accounts' },
  { role: 'Parent (3 children)', username: 'pvgn20250286', code: 'PARENT', note: 'Three children across both departments — use the switcher' },
];

export function Login() {
  const { user, login, loading } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // The door the person is signing in at, remembered between visits.
  const [portalId, setPortalId] = useState(() => {
    return readChoice('vignan.portal', PORTALS.map((p) => p.id), 'PARENTS');
  });
  const portal = PORTALS.find((p) => p.id === portalId) ?? PORTALS[0];

  const [form, setForm] = useState({ login: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Forgotten password. There is no mail server, so the request is queued for
  // the school office rather than sending an unverifiable reset link.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgot, setForgot] = useState({ login: '', contact: '', reason: '' });
  const [forgotState, setForgotState] = useState({ sending: false, sent: null, error: null });

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <span className="spinner" style={{ width: 28, height: 28, color: 'var(--navy-600)' }} />
      </div>
    );
  }
  if (user) return <Navigate to={user.home} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The API detects the role and tells us where this account belongs.
      const account = await login(form.login.trim(), form.password, portalId);
      toast.success(`Welcome back, ${account.fullName.split(' ')[0]}`, `Signed in as ${account.roleName}`);
      navigate(account.home, { replace: true });
    } catch (loginError) {
      setError(loginError.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const openForgot = () => {
    setForgot({ login: form.login.trim(), contact: '', reason: '' });
    setForgotState({ sending: false, sent: null, error: null });
    setForgotOpen(true);
  };

  const submitForgot = async (event) => {
    event.preventDefault();
    setForgotState({ sending: true, sent: null, error: null });
    try {
      const result = await api.post('/auth/forgot-password', {
        login: forgot.login.trim(),
        contact: forgot.contact.trim() || undefined,
        reason: forgot.reason.trim() || undefined,
      });
      setForgotState({ sending: false, sent: result.message, error: null });
    } catch (requestError) {
      setForgotState({ sending: false, sent: null, error: requestError.message || 'Could not send the request' });
    }
  };

  const choosePortal = (id) => {
    setPortalId(id);
    writeSetting('vignan.portal', id);
    setError(null);
  };

  const useDemo = (account) => {
    // Selecting a demo account moves to the door that account belongs to,
    // rather than bouncing the tester off the wrong portal.
    choosePortal(portalForRole(account.code));
    setForm({ login: account.username, password: 'Vignan@123' });
    setError(null);
  };

  return (
    <div className="login-page">
      <aside className="login-hero">
        <div className="row" style={{ gap: 12, position: 'relative', zIndex: 1 }}>
          <span className="brand-mark" style={{ width: 42, height: 42, fontSize: 19 }}>
            V
          </span>
          <div>
            <strong style={{ color: '#fff', fontSize: 17, fontFamily: 'var(--font-display)' }}>
              Vignan Educational Institutions
            </strong>
            <div style={{ color: 'var(--navy-300)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              School ERP Portal
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>One portal for the entire institution.</h1>
          <p className="mb-5">
            Admissions, academics, attendance, examinations, fees, payroll, transport and communication — governed by
            role-based access from a single secure system.
          </p>

          <div className="hero-points">
            <div className="hero-point">
              <span className="hp-icon">
                <Icon name="shield-check" size={18} />
              </span>
              <div>
                <strong>Role-based access control</strong>
                <span>Six roles, granular permissions, enforced at the API.</span>
              </div>
            </div>
            <div className="hero-point">
              <span className="hp-icon">
                <Icon name="users" size={18} />
              </span>
              <div>
                <strong>Four separate sections</strong>
                <span>Admin, Administrator, Faculty, and Parents.</span>
              </div>
            </div>
            <div className="hero-point">
              <span className="hp-icon">
                <Icon name="history" size={18} />
              </span>
              <div>
                <strong>Every action audited</strong>
                <span>Logins, approvals, marks, fees and permission changes.</span>
              </div>
            </div>
          </div>
        </div>

        <p style={{ position: 'relative', zIndex: 1, fontSize: 12, color: 'rgba(207,224,244,0.6)' }}>
          © {new Date().getFullYear()} Vignan Educational Institutions. All rights reserved.
        </p>
      </aside>

      <main className="login-panel">
        <div className="login-box">
          <div className="login-logo">
            <span className="brand-mark">V</span>
            <div>
              <strong style={{ fontSize: 16, fontFamily: 'var(--font-display)' }}>Vignan ERP</strong>
              <div className="text-xs text-muted">Educational Institutions</div>
            </div>
          </div>

          <h2 style={{ fontSize: 'var(--text-2xl)' }}>Sign in</h2>
          <p className="text-muted mt-2 mb-4">Choose your portal, then enter the credentials issued by the school.</p>

          <div className="portal-picker" role="radiogroup" aria-label="Portal">
            {PORTALS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={entry.id === portalId}
                className={`portal-tile${entry.id === portalId ? ' on' : ''}`}
                onClick={() => choosePortal(entry.id)}
              >
                <Icon name={entry.icon} size={17} />
                <span>{entry.short}</span>
              </button>
            ))}
          </div>
          <p className="portal-hint">
            <Icon name="info" size={12} />
            <span>
              <strong>{portal.label} portal.</strong> {portal.hint}
            </span>
          </p>

          {error && (
            <div className="error-state mb-4" style={{ padding: 12 }}>
              <Icon name="alert-circle" size={18} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={submit}>
            <Field label="Username or email" required>
              <Input
                value={form.login}
                onChange={(event) => setForm({ ...form, login: event.target.value })}
                placeholder={portal.placeholder}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label="Password" required>
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  style={{ position: 'absolute', right: 2, top: 1, width: 32, height: 32 }}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'x-circle' : 'eye'} size={16} />
                </button>
              </div>
            </Field>

            <Button type="submit" variant="primary" size="lg" className="btn-block mt-4" loading={submitting}>
              {submitting ? 'Signing in' : `Sign in to ${portal.short}`}
            </Button>
          </form>

          <div className="row mt-4" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openForgot}>
              <Icon name="key" size={14} /> Forgot your password?
            </button>
          </div>

          <div className="demo-accounts">
            <div className="row-between">
              <strong className="text-sm">Demo accounts</strong>
              <span className="text-xs text-muted mono">Vignan@123</span>
            </div>
            <p className="text-xs text-muted mt-2">
              Tap an account to fill the form, then sign in to see that role&apos;s portal.
            </p>
            <div className="demo-grid">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  className="demo-chip"
                  onClick={() => useDemo(account)}
                  title={account.note}
                >
                  <strong>{account.role}</strong>
                  <span>{account.username}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* ------------------------------------------ forgotten password */}
      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Forgot your password?"
        subtitle="The school office will issue a temporary password"
      >
        {forgotState.sent ? (
          <div className="stack-sm">
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span className="stat-icon tone-green" style={{ width: 38, height: 38, flexShrink: 0 }}>
                <Icon name="check-circle" size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>Request sent</strong>
                <p className="text-sm text-muted mt-1">{forgotState.sent}</p>
              </div>
            </div>
            <Button variant="primary" className="btn-block mt-4" onClick={() => setForgotOpen(false)}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submitForgot}>
            <p className="text-sm text-muted mb-4">
              Tell us which account you cannot get into. A member of staff will identify you at the school office or on
              the telephone and hand over a temporary password, which you will change when you sign in.
            </p>

            {forgotState.error && (
              <div className="error-state mb-4" style={{ padding: 12 }}>
                <Icon name="alert-circle" size={18} />
                <span className="text-sm">{forgotState.error}</span>
              </div>
            )}

            <Field label="Username or email" required>
              <Input
                value={forgot.login}
                onChange={(event) => setForgot({ ...forgot, login: event.target.value })}
                placeholder="e.g. vgn20250001"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="A telephone number we can reach you on" hint="So the office can confirm it is really you">
              <Input
                value={forgot.contact}
                onChange={(event) => setForgot({ ...forgot, contact: event.target.value })}
                placeholder="e.g. +91 98450 00000"
              />
            </Field>
            <Field label="Anything else the office should know">
              <Textarea
                rows={3}
                value={forgot.reason}
                onChange={(event) => setForgot({ ...forgot, reason: event.target.value })}
                placeholder="Optional"
              />
            </Field>

            <Button type="submit" variant="primary" className="btn-block mt-2" loading={forgotState.sending}>
              {forgotState.sending ? 'Sending' : 'Send the request'}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default Login;
