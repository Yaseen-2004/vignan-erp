import { useLookups } from '../../hooks/useLookups.js';
import { ResourcePage } from '../../components/ResourcePage.jsx';
import { Avatar, Badge, formatCurrency } from '../../components/ui.jsx';

/**
 * Parent accounts. A single account may hold several children, which is what
 * the parent portal's child switcher relies on.
 */
export function Parents() {
  const { lookups } = useLookups();

  return (
    <ResourcePage
      title="Parents"
      subtitle="One parent account can be linked to multiple children across different classes."
      endpoint="/parents"
      module="parents"
      lookups={lookups}
      createLabel="Add Parent"
      searchPlaceholder="Search by parent name, phone, code or email..."
      columns={[
        {
          key: 'parent',
          label: 'Parent',
          render: (row) => (
            <div className="row-person">
              <Avatar name={row.father_name || row.mother_name || 'Parent'} src={row.photo} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className="cell-primary truncate">{row.father_name || row.guardian_name || '—'}</div>
                <div className="cell-sub mono">{row.parent_code}</div>
              </div>
            </div>
          ),
        },
        { key: 'mother_name', label: 'Mother', render: (row) => row.mother_name || '—' },
        {
          key: 'children',
          label: 'Children',
          render: (row) =>
            row.children?.length ? (
              <div className="stack-sm">
                {row.children.map((child) => (
                  <div key={child.id} className="text-sm">
                    <span className="fw-600">
                      {child.first_name} {child.last_name}
                    </span>
                    <span className="text-muted">
                      {' '}
                      — {child.class_name} {child.section_name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-muted">No children linked</span>
            ),
        },
        { key: 'phone', label: 'Contact', render: (row) => row.phone || row.father_phone || '—' },
        {
          key: 'annual_income',
          label: 'Annual Income',
          numeric: true,
          render: (row) => (row.annual_income ? formatCurrency(row.annual_income) : '—'),
        },
        { key: 'username', label: 'Login', render: (row) => (row.username ? <span className="mono">{row.username}</span> : <span className="text-muted">No account</span>) },
        { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
      ]}
      mobileColumns={['children', 'phone', 'status']}
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
        { name: 'father_name', label: "Father's name", section: 'Parents' },
        { name: 'father_occupation', label: "Father's occupation", section: 'Parents' },
        { name: 'father_phone', label: "Father's phone", section: 'Parents' },
        { name: 'mother_name', label: "Mother's name", section: 'Parents' },
        { name: 'mother_occupation', label: "Mother's occupation", section: 'Parents' },
        { name: 'mother_phone', label: "Mother's phone", section: 'Parents' },
        { name: 'guardian_name', label: 'Guardian name', section: 'Parents' },
        {
          name: 'relation',
          label: 'Primary relation',
          type: 'select',
          options: ['FATHER', 'MOTHER', 'GUARDIAN'].map((v) => ({ value: v, label: v })),
          default: 'FATHER',
          section: 'Parents',
        },

        { name: 'phone', label: 'Contact phone', section: 'Contact' },
        { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
        { name: 'annual_income', label: 'Annual income', type: 'number', section: 'Contact' },
        { name: 'address', label: 'Address', type: 'textarea', full: true, section: 'Contact' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ],
          default: 'ACTIVE',
          section: 'Contact',
        },

        {
          name: 'create_account',
          label: 'Portal access',
          type: 'checkbox',
          checkboxLabel: 'Create a parent portal login',
          default: true,
          section: 'Portal access',
        },
        { name: 'username', label: 'Username', hint: 'Generated when left blank', section: 'Portal access' },
        { name: 'password', label: 'Password', type: 'password', hint: 'Generated when left blank', section: 'Portal access' },
      ]}
    />
  );
}

export default Parents;
