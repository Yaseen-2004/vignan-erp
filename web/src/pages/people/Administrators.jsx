import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { ResourcePage } from '../../components/ResourcePage.jsx';
import { PermissionMatrix } from '../../components/PermissionMatrix.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Avatar, Badge, Button, LoadingBlock, Modal, formatDate, useFetch } from '../../components/ui.jsx';

/**
 * Administrator accounts.
 *
 * Only the Admin reaches this page. Besides the usual CRUD it exposes the
 * permission assignment the specification calls for — an Administrator's
 * access is decided here, and every change is written to the audit log.
 */
export function Administrators() {
  const { lookups } = useLookups();
  const { can } = useAuth();
  const toast = useToast();

  const [permissionTarget, setPermissionTarget] = useState(null);
  const [allow, setAllow] = useState([]);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);

  const { data: catalogue } = useFetch(() => api.get('/roles/permissions'), []);
  const { data: detail, loading: detailLoading } = useFetch(
    () => api.get(`/administrators/${permissionTarget.id}`),
    [permissionTarget?.id],
    { skip: !permissionTarget }
  );

  // The effective set = role baseline + ALLOW overrides − DENY overrides.
  useEffect(() => {
    if (!detail) return;
    const base = new Set(detail.rolePermissions || []);
    for (const override of detail.overrides || []) {
      if (override.effect === 'ALLOW') base.add(override.code);
      else base.delete(override.code);
    }
    setAllow([...base]);
  }, [detail]);

  const savePermissions = async () => {
    setSaving(true);
    try {
      const baseline = new Set(detail.rolePermissions || []);
      const selected = new Set(allow);
      // Anything selected but not in the role baseline is an explicit ALLOW.
      const allowList = [...selected].filter((code) => !baseline.has(code));
      // Anything in the baseline but unselected is an explicit DENY.
      const denyList = [...baseline].filter((code) => !selected.has(code));

      await api.put(`/administrators/${permissionTarget.id}/permissions`, { allow: allowList, deny: denyList });
      toast.success(
        'Permissions updated',
        `${allowList.length} added, ${denyList.length} withheld for ${permissionTarget.full_name}`
      );
      setPermissionTarget(null);
      setNonce((n) => n + 1);
    } catch (error) {
      toast.fromError(error, 'Could not update permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ResourcePage
        key={nonce}
        title="Administrators"
        subtitle="Administrators manage students and faculty. Their access is granted here by the Admin."
        endpoint="/administrators"
        module="administrators"
        lookups={lookups}
        createLabel="Add Administrator"
        searchPlaceholder="Search by name, employee code or designation..."
        columns={[
          {
            key: 'administrator',
            label: 'Administrator',
            render: (row) => (
              <div className="row-person">
                <Avatar name={row.full_name} src={row.photo} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div className="cell-primary truncate">{row.full_name}</div>
                  <div className="cell-sub mono">{row.employee_code}</div>
                </div>
              </div>
            ),
          },
          { key: 'designation', label: 'Designation', render: (row) => row.designation || '—' },
          {
            key: 'board',
            label: 'Wing',
            render: (row) =>
              row.board === 'BOTH' || !row.board ? (
                <Badge tone="neutral" dot={false}>Both departments</Badge>
              ) : (
                <Badge tone={row.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                  {row.board === 'CBSE' ? 'CBSE only' : 'State Board only'}
                </Badge>
              ),
          },
          { key: 'department_name', label: 'Department', render: (row) => row.department_name || '—' },
          { key: 'email', label: 'Email', render: (row) => <span className="truncate">{row.email}</span> },
          {
            key: 'permissions',
            label: 'Permissions',
            render: (row) => (
              <div className="row" style={{ gap: 6 }}>
                {row.extra_permissions > 0 && (
                  <Badge tone="success" dot={false}>
                    +{row.extra_permissions}
                  </Badge>
                )}
                {row.revoked_permissions > 0 && (
                  <Badge tone="danger" dot={false}>
                    −{row.revoked_permissions}
                  </Badge>
                )}
                {!row.extra_permissions && !row.revoked_permissions && (
                  <span className="text-muted text-xs">Role defaults</span>
                )}
              </div>
            ),
          },
          {
            key: 'last_login_at',
            label: 'Last Login',
            render: (row) => (row.last_login_at ? formatDate(row.last_login_at) : 'Never'),
          },
          {
            key: 'status',
            label: 'Status',
            badge: true,
            render: (row) => <Badge status={row.account_status || row.status}>{row.account_status || row.status}</Badge>,
          },
          ...(can('roles.manage')
            ? [
                {
                  key: '__perm',
                  label: '',
                  render: (row) => (
                    <Button
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPermissionTarget(row);
                      }}
                    >
                      <Icon name="shield-check" size={13} /> Permissions
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
        mobileColumns={['designation', 'department_name', 'email', 'status']}
        filters={[
          {
            name: 'status',
            label: 'status',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ],
          },
        ]}
        fields={[
          { name: 'full_name', label: 'Full name', required: true, section: 'Account' },
          { name: 'email', label: 'Email', type: 'email', required: true, section: 'Account' },
          { name: 'username', label: 'Username', hint: 'Defaults to the employee code', section: 'Account' },
          { name: 'password', label: 'Password', type: 'password', hint: 'Leave blank to generate one', section: 'Account' },
          { name: 'phone', label: 'Phone', section: 'Account' },
          {
            name: 'gender',
            label: 'Gender',
            type: 'select',
            options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })),
            section: 'Account',
          },
          { name: 'employee_code', label: 'Employee code', section: 'Role' },
          { name: 'designation', label: 'Designation', default: 'Administrator', section: 'Role' },
          {
            name: 'board',
            label: 'Department (wing)',
            type: 'select',
            options: [
              { value: 'BOTH', label: 'Both — State Board and CBSE' },
              { value: 'STATE', label: 'State Board only' },
              { value: 'CBSE', label: 'CBSE only' },
            ],
            default: 'BOTH',
            hint: 'Confines every list, record and report this administrator can reach. Enforced by the API.',
            section: 'Role',
          },
          {
            name: 'department_id',
            label: 'Department',
            type: 'select',
            options: () => (lookups.departments || []).map((d) => ({ value: d.id, label: d.name })),
            section: 'Role',
          },
          { name: 'qualification', label: 'Qualification', section: 'Role' },
          { name: 'date_of_joining', label: 'Date of joining', type: 'date', section: 'Role' },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ],
            default: 'ACTIVE',
            section: 'Role',
          },
          { name: 'emergency_contact', label: 'Emergency contact', section: 'Contact' },
          { name: 'address', label: 'Address', type: 'textarea', full: true, section: 'Contact' },
        ]}
      />

      <Modal
        open={!!permissionTarget}
        onClose={() => setPermissionTarget(null)}
        size="xwide"
        title={`Permissions — ${permissionTarget?.full_name ?? ''}`}
        subtitle="Grant or withhold individual permissions for this administrator. The API enforces the result."
        footer={
          <>
            <Button onClick={() => setPermissionTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="save" onClick={savePermissions} loading={saving}>
              Save permissions
            </Button>
          </>
        }
      >
        {detailLoading || !catalogue || !detail ? (
          <LoadingBlock label="Loading permission matrix" />
        ) : (
          <PermissionMatrix
            catalogue={catalogue}
            selected={allow}
            baseline={detail.rolePermissions}
            mode="override"
            onChange={setAllow}
            lockedModules={['settings', 'roles', 'audit', 'campuses']}
          />
        )}
      </Modal>
    </>
  );
}

export default Administrators;
