import { useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ResourcePage } from '../../components/ResourcePage.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Button, ConfirmDialog, Dropdown, Modal, formatDateTime,
} from '../../components/ui.jsx';

const ROLES = ['ADMIN', 'ADMINISTRATOR', 'TEACHING_STAFF', 'FINANCIAL_STAFF', 'STUDENT', 'PARENT'];

/**
 * Master user list — every account in the system, whatever its role.
 * Admin-only: create, activate, deactivate and reset passwords.
 */
export function Users() {
  const toast = useToast();
  const { user } = useAuth();

  const [nonce, setNonce] = useState(0);
  const [statusTarget, setStatusTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [busy, setBusy] = useState(false);

  const changeStatus = async () => {
    setBusy(true);
    try {
      const next = statusTarget.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api.patch(`/users/${statusTarget.id}/status`, { status: next });
      toast.success(`Account ${next === 'ACTIVE' ? 'activated' : 'deactivated'}`, statusTarget.full_name);
      setStatusTarget(null);
      setNonce((n) => n + 1);
    } catch (error) {
      toast.fromError(error);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    setBusy(true);
    try {
      const result = await api.post(`/users/${resetTarget.id}/reset-password`, {});
      setTempPassword({ user: resetTarget, password: result.data.temporaryPassword });
      setResetTarget(null);
      toast.success('Password reset', 'Share the temporary password with the user.');
    } catch (error) {
      toast.fromError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ResourcePage
        key={nonce}
        title="Users"
        subtitle="Every account in the ERP. Create, activate, deactivate and reset credentials."
        endpoint="/users"
        module="users"
        createLabel="Add User"
        searchPlaceholder="Search by name, username, email or phone..."
        columns={[
          {
            key: 'user',
            label: 'User',
            render: (row) => (
              <div className="row-person">
                <Avatar name={row.full_name} src={row.photo} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div className="cell-primary truncate">{row.full_name}</div>
                  <div className="cell-sub mono">{row.username}</div>
                </div>
              </div>
            ),
          },
          { key: 'email', label: 'Email', render: (row) => <span className="truncate">{row.email}</span> },
          {
            key: 'role_code',
            label: 'Role',
            render: (row) => (
              <Badge tone={row.role_code === 'ADMIN' ? 'danger' : 'neutral'} dot={false}>
                {row.role_name}
              </Badge>
            ),
          },
          { key: 'campus_name', label: 'Campus', render: (row) => row.campus_name || '—' },
          {
            key: 'override_count',
            label: 'Overrides',
            numeric: true,
            render: (row) => (row.override_count ? <Badge tone="info" dot={false}>{row.override_count}</Badge> : '—'),
          },
          {
            key: 'last_login_at',
            label: 'Last Login',
            sortable: true,
            render: (row) => (row.last_login_at ? formatDateTime(row.last_login_at) : 'Never'),
          },
          { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
          {
            key: '__actions',
            label: '',
            render: (row) => (
              <Dropdown
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle();
                    }}
                    aria-label="Account actions"
                  >
                    <Icon name="more-vertical" size={16} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setStatusTarget(row);
                        close();
                      }}
                      disabled={row.id === user.id}
                    >
                      <Icon name={row.status === 'ACTIVE' ? 'ban' : 'check-circle'} size={16} />
                      {row.status === 'ACTIVE' ? 'Deactivate account' : 'Activate account'}
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        setResetTarget(row);
                        close();
                      }}
                    >
                      <Icon name="key" size={16} /> Reset password
                    </button>
                  </>
                )}
              </Dropdown>
            ),
          },
        ]}
        mobileColumns={['email', 'role_code', 'last_login_at', 'status']}
        filters={[
          { name: 'role', label: 'roles', options: ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })) },
          {
            name: 'status',
            label: 'status',
            options: ['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((v) => ({ value: v, label: v })),
          },
        ]}
        fields={[
          { name: 'full_name', label: 'Full name', required: true },
          { name: 'username', label: 'Username', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'password', label: 'Password', type: 'password', hint: 'Leave blank to generate a temporary one' },
          { name: 'phone', label: 'Phone' },
          {
            name: 'gender',
            label: 'Gender',
            type: 'select',
            options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })),
          },
          {
            name: 'role_code',
            label: 'Role',
            type: 'select',
            required: true,
            options: ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })),
            hint: 'Creating an ADMIN account requires Admin rights',
          },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: ['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((v) => ({ value: v, label: v })),
            default: 'ACTIVE',
          },
        ]}
      />

      <ConfirmDialog
        open={!!statusTarget}
        title={statusTarget?.status === 'ACTIVE' ? 'Deactivate this account?' : 'Activate this account?'}
        message={
          statusTarget?.status === 'ACTIVE'
            ? `${statusTarget?.full_name} will be signed out everywhere and will not be able to sign in again until reactivated.`
            : `${statusTarget?.full_name} will be able to sign in again.`
        }
        confirmLabel={statusTarget?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        variant={statusTarget?.status === 'ACTIVE' ? 'danger' : 'success'}
        loading={busy}
        onCancel={() => setStatusTarget(null)}
        onConfirm={changeStatus}
      />

      <ConfirmDialog
        open={!!resetTarget}
        title="Reset this password?"
        message={`A new temporary password will be generated for ${resetTarget?.full_name}. They will be signed out of all devices and must set a new password at next sign-in.`}
        confirmLabel="Reset password"
        loading={busy}
        onCancel={() => setResetTarget(null)}
        onConfirm={resetPassword}
      />

      <Modal
        open={!!tempPassword}
        onClose={() => setTempPassword(null)}
        title="Temporary password"
        size="narrow"
        footer={<Button variant="primary" onClick={() => setTempPassword(null)}>Done</Button>}
      >
        {tempPassword && (
          <div className="stack">
            <p className="text-muted text-sm">
              Share this with <strong>{tempPassword.user.full_name}</strong>. It is shown only once.
            </p>
            <div
              className="card"
              style={{ padding: 16, textAlign: 'center', background: 'var(--warning-50)', borderColor: '#fde68a' }}
            >
              <div className="mono" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '0.05em' }}>
                {tempPassword.password}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default Users;
