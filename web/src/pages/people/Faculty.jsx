import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLookups } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ResourcePage } from '../../components/ResourcePage.jsx';
import { Avatar, Badge, Tabs, formatDate } from '../../components/ui.jsx';

/** Which of the school's two departments a staff member serves. */
const BOARD_OPTIONS = [
  { value: 'STATE', label: 'State Board' },
  { value: 'CBSE', label: 'CBSE' },
  { value: 'BOTH', label: 'Both departments' },
];
const BOARD_LABEL = { STATE: 'State Board', CBSE: 'CBSE', BOTH: 'Both' };


const CATEGORY_TABS = [
  { key: 'ALL', label: 'All Faculty' },
  { key: 'TEACHING', label: 'Teaching Staff' },
  { key: 'FINANCIAL', label: 'Financial Staff' },
];

/**
 * Faculty list covering both categories the specification defines.
 * `fixedType` pins the page to one category (used by the Financial Staff
 * portal, which only ever needs the directory).
 */
export function Faculty({ basePath = '/administrator', fixedType, readOnly = false }) {
  const { lookups } = useLookups();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState(fixedType || 'ALL');

  return (
    <ResourcePage
      key={category}
      title={fixedType === 'FINANCIAL' ? 'Financial Staff' : fixedType === 'TEACHING' ? 'Teaching Staff' : 'Faculty'}
      subtitle="Faculty is divided into Teaching Staff and Financial Staff, each with its own portal and permissions."
      endpoint={`/faculty${category !== 'ALL' ? `?staff_type=${category}` : ''}`}
      module="faculty"
      departmentScoped
      lookups={lookups}
      exportKey="faculty"
      readOnly={readOnly}
      canCreate={!readOnly && can('faculty.create')}
      createLabel="Add Faculty"
      searchPlaceholder="Search by name, faculty code, email or designation..."
      onRowClick={(row) => navigate(`${basePath}/faculty/${row.id}`)}
      headerExtra={
        !fixedType && (
          <div className="mb-4">
            <Tabs tabs={CATEGORY_TABS} active={category} onChange={setCategory} pill />
          </div>
        )
      }
      columns={[
        {
          key: 'faculty',
          label: 'Faculty',
          render: (row) => (
            <div className="row-person">
              <Avatar name={row.full_name} src={row.photo} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className="cell-primary truncate">{row.full_name}</div>
                <div className="cell-sub mono">{row.faculty_code}</div>
              </div>
            </div>
          ),
        },
        {
          key: 'staff_type',
          label: 'Category',
          render: (row) => <Badge status={row.staff_type}>{row.staff_type}</Badge>,
        },
        {
          key: 'board',
          label: 'Department',
          render: (row) => (
            <Badge tone={row.board === 'CBSE' ? 'purple' : row.board === 'STATE' ? 'info' : 'neutral'} dot={false}>
              {BOARD_LABEL[row.board] || 'Both'}
            </Badge>
          ),
        },
        { key: 'designation', label: 'Designation', render: (row) => row.designation || '—' },
        { key: 'department_name', label: 'Subject Dept.', render: (row) => row.department_name || '—' },
        { key: 'qualification', label: 'Qualification', render: (row) => row.qualification || '—' },
        { key: 'assigned_courses', label: 'Courses', numeric: true },
        { key: 'mentee_count', label: 'Mentees', numeric: true },
        { key: 'date_of_joining', label: 'Joined', sortable: true, render: (row) => formatDate(row.date_of_joining) },
        { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
      ]}
      mobileColumns={['staff_type', 'board', 'designation', 'status']}
      filters={[
        {
          name: 'department_id',
          label: 'subject departments',
          placeholder: 'All subject depts',
          options: () => (lookups.departments || []).map((d) => ({ value: d.id, label: d.name })),
        },
        {
          name: 'status',
          label: 'status',
          options: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
        },
      ]}
      fields={[
        { name: 'full_name', label: 'Full name', required: true, section: 'Account' },
        { name: 'email', label: 'Email', type: 'email', required: true, section: 'Account' },
        { name: 'username', label: 'Username', hint: 'Defaults to the faculty code', section: 'Account' },
        { name: 'password', label: 'Password', type: 'password', hint: 'Leave blank to generate one', section: 'Account' },
        { name: 'phone', label: 'Phone', section: 'Account' },
        {
          name: 'board',
          label: 'Department',
          type: 'select',
          options: () => BOARD_OPTIONS,
          default: 'BOTH',
          hint: 'Which wing this member serves',
          section: 'Account',
        },
        {
          name: 'gender',
          label: 'Gender',
          type: 'select',
          options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })),
          section: 'Account',
        },

        {
          name: 'staff_type',
          label: 'Faculty category',
          type: 'select',
          required: true,
          options: [
            { value: 'TEACHING', label: 'Teaching Staff' },
            { value: 'FINANCIAL', label: 'Financial Staff' },
          ],
          default: fixedType || 'TEACHING',
          hint: 'This decides which portal and permissions they receive',
          section: 'Employment',
        },
        { name: 'faculty_code', label: 'Faculty code', hint: 'Generated when left blank', section: 'Employment' },
        { name: 'designation', label: 'Designation', section: 'Employment' },
        {
          name: 'department_id',
          label: 'Department',
          type: 'select',
          options: () => (lookups.departments || []).map((d) => ({ value: d.id, label: d.name })),
          section: 'Employment',
        },
        { name: 'qualification', label: 'Qualification', section: 'Employment' },
        { name: 'specialization', label: 'Specialization', section: 'Employment' },
        { name: 'experience_years', label: 'Experience (years)', type: 'number', step: '0.5', section: 'Employment' },
        { name: 'date_of_joining', label: 'Date of joining', type: 'date', section: 'Employment' },
        {
          name: 'is_mentor',
          label: 'Mentor',
          type: 'checkbox',
          checkboxLabel: 'Available as a student mentor',
          section: 'Employment',
        },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') })),
          default: 'ACTIVE',
          section: 'Employment',
        },

        { name: 'date_of_birth', label: 'Date of birth', type: 'date', section: 'Personal' },
        { name: 'blood_group', label: 'Blood group', section: 'Personal' },
        { name: 'emergency_contact', label: 'Emergency contact', section: 'Personal' },
        { name: 'bank_account', label: 'Bank account', section: 'Personal' },
        { name: 'pan_number', label: 'PAN number', section: 'Personal' },
        { name: 'address', label: 'Address', type: 'textarea', full: true, section: 'Personal' },
      ]}
    />
  );
}

export default Faculty;
