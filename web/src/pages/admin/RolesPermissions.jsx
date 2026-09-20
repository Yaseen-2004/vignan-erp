import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { PermissionMatrix } from '../../components/PermissionMatrix.jsx';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, PageHeader, Stat, Textarea, useFetch,
} from '../../components/ui.jsx';

const ROLE_TONE = {
  ADMIN: 'tone-red',
  ADMINISTRATOR: 'tone-navy',
  TEACHING_STAFF: 'tone-blue',
  FINANCIAL_STAFF: 'tone-teal',
  STUDENT: 'tone-green',
  PARENT: 'tone-amber',
};

const ROLE_ICON = {
  ADMIN: 'shield-check',
  ADMINISTRATOR: 'user-cog',
  TEACHING_STAFF: 'book-open',
  FINANCIAL_STAFF: 'calculator',
  STUDENT: 'graduation-cap',
  PARENT: 'users',
};

/**
 * Roles and permissions — Admin only.
 *
 * The Admin role is deliberately locked: the server refuses to strip its
 * access, so the matrix is shown read-only for it.
 */
export function RolesPermissions() {
  const toast = useToast();

  const [selectedRole, setSelectedRole] = useState(null);
  const [codes, setCodes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ code: '', name: '', description: '', level: 50 });
  const [deleting, setDeleting] = useState(null);
  const [nonce, setNonce] = useState(0);

  const { data: roles, loading, error, refetch } = useFetch(() => api.get('/roles'), [nonce]);
  const { data: catalogue } = useFetch(() => api.get('/roles/permissions'), []);
  const { data: roleDetail, loading: detailLoading } = useFetch(
    () => api.get(`/roles/${selectedRole.id}`),
    [selectedRole?.id],
    { skip: !selectedRole }
  );

  useEffect(() => {
    if (roleDetail) setCodes(roleDetail.permissions.map((permission) => permission.code));
  }, [roleDetail]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/roles/${selectedRole.id}/permissions`, { codes });
      toast.success('Role permissions updated', `${codes.length} permissions on ${selectedRole.name}`);
      setSelectedRole(null);
      setNonce((n) => n + 1);
    } catch (saveError) {
      toast.fromError(saveError, 'Could not update this role');
    } finally {
      setSaving(false);
    }
  };

  const createRole = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post('/roles', { ...newRole, level: Number(newRole.level) });
      toast.success('Role created', newRole.name);
      setCreating(false);
      setNewRole({ code: '', name: '', description: '', level: 50 });
      setNonce((n) => n + 1);
    } catch (createError) {
      toast.fromError(createError, 'Could not create this role');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    setSaving(true);
    try {
      await api.delete(`/roles/${deleting.id}`);
      toast.success('Role deleted');
      setDeleting(null);
      setNonce((n) => n + 1);
    } catch (deleteError) {
      toast.fromError(deleteError, 'Could not delete this role');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock label="Loading roles" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const totalUsers = roles.reduce((sum, role) => sum + role.user_count, 0);

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Only the Admin may change what each role can do. Every change is written to the audit log."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Create role
          </Button>
        }
      />

      <div className="grid grid-stats mb-5">
        <Stat label="Roles" value={roles.length} icon="shield" tone="navy" meta={`${roles.filter((r) => r.is_system).length} system roles`} />
        <Stat label="Users assigned" value={totalUsers} icon="users" tone="blue" />
        <Stat
          label="Permission codes"
          value={catalogue?.reduce((sum, group) => sum + group.permissions.length, 0) ?? '—'}
          icon="key"
          tone="purple"
          meta={`${catalogue?.length ?? 0} modules`}
        />
      </div>

      <div className="grid grid-3">
        {roles.map((role) => (
          <Card key={role.id}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span className={`stat-icon ${ROLE_TONE[role.code] || 'tone-navy'}`} style={{ width: 40, height: 40 }}>
                <Icon name={ROLE_ICON[role.code] || 'shield'} size={19} />
              </span>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="row-between">
                  <strong style={{ fontSize: 'var(--text-md)' }}>{role.name}</strong>
                  {role.is_system ? (
                    <Badge tone="neutral" dot={false}>
                      System
                    </Badge>
                  ) : (
                    <Badge tone="info" dot={false}>
                      Custom
                    </Badge>
                  )}
                </div>
                <div className="text-xs mono text-muted">{role.code}</div>
              </div>
            </div>

            <p className="text-sm text-muted mt-3" style={{ minHeight: 40 }}>
              {role.description}
            </p>

            <div className="row-between mt-4" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div>
                <div className="stat-label">Permissions</div>
                <strong>{role.permission_count}</strong>
              </div>
              <div>
                <div className="stat-label">Users</div>
                <strong>{role.user_count}</strong>
              </div>
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" onClick={() => setSelectedRole(role)}>
                  {role.code === 'ADMIN' ? 'View' : 'Edit'}
                </Button>
                {!role.is_system && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    style={{ color: 'var(--danger-700)' }}
                    onClick={() => setDeleting(role)}
                    aria-label="Delete role"
                  />
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={!!selectedRole}
        onClose={() => setSelectedRole(null)}
        size="xwide"
        title={`${selectedRole?.name ?? ''} permissions`}
        subtitle={
          selectedRole?.code === 'ADMIN'
            ? 'The Admin role always holds every permission and cannot be restricted.'
            : `${codes.length} permissions selected · ${selectedRole?.user_count ?? 0} user(s) affected`
        }
        footer={
          selectedRole?.code === 'ADMIN' ? (
            <Button onClick={() => setSelectedRole(null)}>Close</Button>
          ) : (
            <>
              <Button onClick={() => setSelectedRole(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" icon="save" onClick={save} loading={saving}>
                Save permissions
              </Button>
            </>
          )
        }
      >
        {detailLoading || !catalogue ? (
          <LoadingBlock label="Loading permission matrix" />
        ) : (
          <PermissionMatrix
            catalogue={catalogue}
            selected={codes}
            onChange={setCodes}
            disabled={selectedRole?.code === 'ADMIN'}
          />
        )}
      </Modal>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a role"
        subtitle="Custom roles start with no permissions; grant them after creating."
        footer={
          <>
            <Button onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="save" onClick={createRole} loading={saving}>
              Create role
            </Button>
          </>
        }
      >
        <form onSubmit={createRole}>
          <Field label="Role code" required hint="Upper-case letters, numbers and underscores">
            <Input
              value={newRole.code}
              onChange={(event) => setNewRole({ ...newRole, code: event.target.value.toUpperCase() })}
              placeholder="LIBRARIAN"
              required
            />
          </Field>
          <Field label="Display name" required>
            <Input value={newRole.name} onChange={(event) => setNewRole({ ...newRole, name: event.target.value })} required />
          </Field>
          <Field label="Authority level" hint="Lower numbers mean higher authority (Admin is 1)">
            <Input
              type="number"
              min="2"
              max="99"
              value={newRole.level}
              onChange={(event) => setNewRole({ ...newRole, level: event.target.value })}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={newRole.description}
              onChange={(event) => setNewRole({ ...newRole, description: event.target.value })}
            />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this role?"
        message={`${deleting?.name} will be removed. Roles that still have users assigned cannot be deleted.`}
        confirmLabel="Delete role"
        loading={saving}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

export default RolesPermissions;
