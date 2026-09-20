import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Card, DetailList, PageHeader, formatDate, formatDateTime,
} from '../../components/ui.jsx';
import { ROLE_LABEL } from '../../nav.js';

/** Self-service profile for whoever is signed in, whatever their role. */
export function MyProfile() {
  const { user, profile } = useAuth();

  const roleSpecific = () => {
    if (!profile) return [];
    switch (user.role) {
      case 'STUDENT':
        return [
          { label: 'Admission number', value: profile.admission_number },
          { label: 'Roll number', value: profile.roll_number },
          { label: 'Class', value: `${profile.class_name || ''} ${profile.section_name || ''}`.trim() },
          { label: 'Academic year', value: profile.academic_year },
          { label: 'Date of birth', value: formatDate(profile.date_of_birth) },
          { label: 'Blood group', value: profile.blood_group },
          { label: 'Admission date', value: formatDate(profile.admission_date) },
          { label: 'Address', value: profile.address },
        ];
      case 'PARENT':
        return [
          { label: 'Parent code', value: profile.parent_code },
          { label: "Father's name", value: profile.father_name },
          { label: "Mother's name", value: profile.mother_name },
          { label: 'Relation', value: profile.relation },
          { label: 'Address', value: profile.address },
        ];
      case 'TEACHING_STAFF':
      case 'FINANCIAL_STAFF':
        return [
          { label: 'Faculty code', value: profile.faculty_code },
          { label: 'Category', value: <Badge status={profile.staff_type}>{profile.staff_type}</Badge> },
          { label: 'Designation', value: profile.designation },
          { label: 'Department', value: profile.department_name },
          { label: 'Qualification', value: profile.qualification },
          { label: 'Specialization', value: profile.specialization },
          { label: 'Experience', value: profile.experience_years ? `${profile.experience_years} years` : null },
          { label: 'Date of joining', value: formatDate(profile.date_of_joining) },
          { label: 'Mentor', value: profile.is_mentor ? 'Yes' : 'No' },
          { label: 'Address', value: profile.address },
        ];
      case 'ADMINISTRATOR':
        return [
          { label: 'Employee code', value: profile.employee_code },
          { label: 'Designation', value: profile.designation },
          { label: 'Department', value: profile.department_name },
          { label: 'Qualification', value: profile.qualification },
          { label: 'Date of joining', value: formatDate(profile.date_of_joining) },
          { label: 'Address', value: profile.address },
        ];
      default:
        return [];
    }
  };

  // Group the permissions by module for a readable summary.
  const byModule = user.permissions.reduce((acc, code) => {
    const [module] = code.split('.');
    acc[module] = (acc[module] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle="Your account details and the access this role gives you."
        actions={
          <Link to="/change-password" className="btn btn-secondary">
            <Icon name="key" size={16} /> Change password
          </Link>
        }
      />

      <div className="profile-hero mb-5">
        <Avatar name={user.fullName} src={user.photo} size="lg" />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <h2>{user.fullName}</h2>
          <div className="meta">
            <span>
              <Icon name="shield" size={13} /> {ROLE_LABEL[user.role]}
            </span>
            <span>
              <Icon name="mail" size={13} /> {user.email}
            </span>
            {user.campusName && (
              <span>
                <Icon name="building" size={13} /> {user.campusName}
              </span>
            )}
          </div>
        </div>
        <Badge status={user.status}>{user.status}</Badge>
      </div>

      <div className="grid grid-2 mb-4">
        <Card title="Account">
          <DetailList
            items={[
              { label: 'Full name', value: user.fullName },
              { label: 'Username', value: <span className="mono">{user.username}</span> },
              { label: 'Email', value: user.email },
              { label: 'Phone', value: user.phone },
              { label: 'Gender', value: user.gender },
              { label: 'Role', value: user.roleName },
              { label: 'Campus', value: user.campusName },
              { label: 'Last sign-in', value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This is your first sign-in' },
            ]}
          />
        </Card>

        <Card title={`${ROLE_LABEL[user.role]} details`}>
          {roleSpecific().length ? (
            <DetailList items={roleSpecific()} />
          ) : (
            <p className="text-muted text-sm">
              This account has full system access and is not tied to a student or staff record.
            </p>
          )}
        </Card>
      </div>

      <Card title="My access" hint={`${user.permissions.length} permissions granted by the ${user.roleName} role`}>
        <div className="row row-wrap" style={{ gap: 8 }}>
          {Object.entries(byModule)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([module, count]) => (
              <span key={module} className="badge badge-neutral">
                {module.replace(/_/g, ' ')} · {count}
              </span>
            ))}
        </div>
        <p className="field-hint mt-4">
          Permissions are granted by your role and can be adjusted by the Admin. Every API call is checked against
          them, so a page you cannot see is also a page you cannot reach.
        </p>
      </Card>
    </>
  );
}

export default MyProfile;
