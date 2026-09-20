import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLookups } from '../../hooks/useLookups.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ResourcePage } from '../../components/ResourcePage.jsx';
import { StudentsByClass } from '../../components/StudentsByClass.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Avatar, Badge, PageHeader, formatDate } from '../../components/ui.jsx';

import { readChoice, writeSetting } from '../../lib/storage.js';
const opt = (list, labelKey = 'name') => (list || []).map((item) => ({ value: item.id, label: item[labelKey] }));

/** "Class 8 · CBSE" — a class name alone is ambiguous across two departments. */
const classOpt = (list = []) =>
  list.map((c) => ({ value: c.id, label: `${c.name}${c.board ? ` · ${c.board === 'CBSE' ? 'CBSE' : 'State'}` : ''}` }));

const sectionOpt = (list = []) =>
  list.map((sec) => ({
    value: sec.id,
    label: `${sec.class_name || ''} ${sec.name}${sec.board ? ` · ${sec.board === 'CBSE' ? 'CBSE' : 'State'}` : ''}`.trim(),
  }));

/**
 * Student list. Clicking a row opens the 360° profile.
 * `basePath` keeps the links inside whichever portal is showing the list.
 *
 * Two ways of looking at the same roll. Class-wise opens first, because that
 * is how a school thinks about its pupils; the flat list — searchable across
 * every class, and the only place records are created and edited — is one
 * click away and remembered for next time.
 */
export function Students({ basePath = '/administrator' }) {
  const { lookups } = useLookups();
  const { can } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState(() => readChoice('vignan.students.view', ['classes', 'all'], 'classes'));
  const choose = (next) => {
    setView(next);
    writeSetting('vignan.students.view', next);
  };

  const switcher = (
    <div className="view-switch" role="group" aria-label="Student list view">
      <button type="button" className={view === 'classes' ? 'on' : ''} onClick={() => choose('classes')}>
        <Icon name="grid" size={14} /> Class-wise
      </button>
      <button type="button" className={view === 'all' ? 'on' : ''} onClick={() => choose('all')}>
        <Icon name="list" size={14} /> All students
      </button>
    </div>
  );

  if (view === 'classes') {
    return (
      <>
        <PageHeader
          title="Students"
          subtitle="Pick a class to see its roll. Open a record for the full 360° profile."
          actions={switcher}
        />
        <StudentsByClass basePath={basePath} />
      </>
    );
  }

  return (
    <ResourcePage
      title="Students"
      subtitle="Every enrolled student. Open a record for the full 360° profile."
      endpoint="/students"
      module="students"
      departmentScoped
      lookups={lookups}
      exportKey="students"
      searchPlaceholder="Search by name, admission number, roll number or phone..."
      defaultSort={{ column: 'id', order: 'desc' }}
      extraActions={switcher}
      onRowClick={(row) => navigate(`${basePath}/students/${row.id}`)}
      createLabel="Add Student"
      canCreate={can('students.create')}
      columns={[
        {
          key: 'student',
          label: 'Student',
          render: (row) => (
            <div className="row-person">
              <Avatar name={row.full_name} src={row.photo} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div className="cell-primary truncate">{row.full_name}</div>
                <div className="cell-sub mono">{row.admission_number}</div>
              </div>
            </div>
          ),
        },
        {
          key: 'class_name',
          label: 'Class',
          render: (row) => (row.class_name ? `${row.class_name} ${row.section_name || ''}` : '—'),
        },
        {
          key: 'board',
          label: 'Department',
          render: (row) =>
            row.board ? (
              <Badge tone={row.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                {row.board === 'CBSE' ? 'CBSE' : 'State Board'}
              </Badge>
            ) : (
              '—'
            ),
        },
        { key: 'roll_number', label: 'Roll No', render: (row) => row.roll_number || '—' },
        { key: 'gender', label: 'Gender', render: (row) => row.gender || '—' },
        { key: 'phone', label: 'Contact', render: (row) => row.phone || '—' },
        { key: 'mentor_name', label: 'Mentor', render: (row) => row.mentor_name || '—' },
        { key: 'admission_date', label: 'Admitted', sortable: true, render: (row) => formatDate(row.admission_date) },
        { key: 'status', label: 'Status', badge: true, render: (row) => <Badge status={row.status}>{row.status}</Badge> },
      ]}
      mobileColumns={['class_name', 'board', 'roll_number', 'status']}
      filters={[
        { name: 'class_id', label: 'classes', options: () => classOpt(lookups.classes) },
        { name: 'section_id', label: 'sections', options: () => sectionOpt(lookups.sections) },
        {
          name: 'status',
          label: 'status',
          options: ['ACTIVE', 'INACTIVE', 'ALUMNI', 'TRANSFERRED', 'SUSPENDED'].map((v) => ({ value: v, label: v })),
        },
      ]}
      fields={[
        { name: 'first_name', label: 'First name', required: true, section: 'Personal Information' },
        { name: 'last_name', label: 'Last name', section: 'Personal Information' },
        { name: 'date_of_birth', label: 'Date of birth', type: 'date', section: 'Personal Information' },
        {
          name: 'gender',
          label: 'Gender',
          type: 'select',
          options: ['MALE', 'FEMALE', 'OTHER'].map((v) => ({ value: v, label: v })),
          section: 'Personal Information',
        },
        { name: 'blood_group', label: 'Blood group', section: 'Personal Information' },
        { name: 'religion', label: 'Religion', section: 'Personal Information' },
        { name: 'category', label: 'Category', section: 'Personal Information' },
        { name: 'aadhaar_number', label: 'Aadhaar number', section: 'Personal Information' },

        {
          name: 'class_id',
          label: 'Class',
          type: 'select',
          options: () => classOpt(lookups.classes),
          hint: 'The department follows the class you choose',
          section: 'Academic Information',
        },
        {
          name: 'section_id',
          label: 'Section',
          type: 'select',
          options: () => sectionOpt(lookups.sections),
          section: 'Academic Information',
        },
        {
          name: 'academic_year_id',
          label: 'Academic year',
          type: 'select',
          options: () => opt(lookups.academicYears),
          section: 'Academic Information',
        },
        { name: 'roll_number', label: 'Roll number', section: 'Academic Information' },
        {
          name: 'mentor_id',
          label: 'Mentor',
          type: 'select',
          options: () => opt(lookups.mentors, 'full_name'),
          section: 'Academic Information',
        },
        { name: 'admission_date', label: 'Admission date', type: 'date', section: 'Academic Information' },
        { name: 'previous_school', label: 'Previous school', section: 'Academic Information' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: ['ACTIVE', 'INACTIVE', 'ALUMNI', 'TRANSFERRED', 'SUSPENDED'].map((v) => ({ value: v, label: v })),
          default: 'ACTIVE',
          section: 'Academic Information',
        },

        { name: 'phone', label: 'Phone', section: 'Contact' },
        { name: 'email', label: 'Email', type: 'email', section: 'Contact' },
        { name: 'address', label: 'Address', type: 'textarea', full: true, section: 'Contact' },
        { name: 'city', label: 'City', section: 'Contact' },
        { name: 'state', label: 'State', section: 'Contact' },
        { name: 'pincode', label: 'Pincode', section: 'Contact' },
      ]}
    />
  );
}

export default Students;
