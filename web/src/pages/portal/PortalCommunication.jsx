import { useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useActiveStudent } from '../../hooks/useActiveStudent.js';
import { ChildSwitcher } from '../parent/ChildSwitcher.jsx';
import { Icon } from '../../components/Icon.jsx';
import {
  Avatar, Badge, Card, DetailList, EmptyState, ErrorState, LoadingBlock, Modal,
  PageHeader, Pagination, Skeleton, formatDate, useFetch,
} from '../../components/ui.jsx';

/**
 * Broadcast reader shared by the student and parent portals.
 * The API returns only published items addressed to this user.
 */
function BroadcastList({ title, subtitle, endpoint, icon, dateField }) {
  const { prefix } = useActiveStudent();
  const [page, setPage] = useState(1);
  const [reading, setReading] = useState(null);

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`${endpoint}${qs({ page, limit: 20 })}`),
    [page]
  );

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {prefix === '/parent' && <ChildSwitcher />}

      <Card bodyClass="flush">
        {loading || !data ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={5} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState icon={icon} title={`No ${title.toLowerCase()}`} message="Nothing has been published for you yet." />
        ) : (
          <>
            <div className="feed">
              {data.map((item) => (
                <div
                  className="feed-item"
                  key={item.id}
                  onClick={() => setReading(item)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`feed-icon ${item.priority === 'URGENT' ? 'tone-red' : item.priority === 'HIGH' ? 'tone-amber' : 'tone-navy'}`}>
                    <Icon name={icon} size={15} />
                  </span>
                  <div className="feed-body">
                    <strong>{item.title}</strong>
                    <p className="truncate">{item.content}</p>
                    <span className="feed-time">
                      {formatDate(item[dateField])}
                      {item.notice_number ? ` · ${item.notice_number}` : ''}
                      {item.circular_number ? ` · ${item.circular_number}` : ''}
                    </span>
                  </div>
                  {item.priority && item.priority !== 'NORMAL' && <Badge status={item.priority}>{item.priority}</Badge>}
                </div>
              ))}
            </div>
            {meta && <Pagination {...meta} onChange={setPage} />}
          </>
        )}
      </Card>

      <Modal
        open={!!reading}
        onClose={() => setReading(null)}
        title={reading?.title}
        subtitle={reading ? formatDate(reading[dateField]) : ''}
        size="wide"
      >
        {reading && (
          <div className="stack">
            <div className="row row-wrap" style={{ gap: 8 }}>
              {reading.priority && <Badge status={reading.priority}>{reading.priority}</Badge>}
              <Badge tone="neutral" dot={false}>
                {String(reading.target_type || 'ALL').replace(/_/g, ' ')}
              </Badge>
              {reading.created_by_name && <span className="text-xs text-muted">Issued by {reading.created_by_name}</span>}
            </div>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{reading.content}</p>
            {reading.attachment && (
              <a href={reading.attachment} target="_blank" rel="noreferrer" className="btn btn-secondary">
                <Icon name="paperclip" size={15} /> Open attachment
              </a>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export function PortalAnnouncements() {
  return (
    <BroadcastList
      title="Announcements"
      subtitle="School announcements addressed to you."
      endpoint="/communication/announcements"
      icon="megaphone"
      dateField="publish_date"
    />
  );
}

export function PortalNotices() {
  return (
    <BroadcastList
      title="Notices"
      subtitle="Formal notices issued by the school."
      endpoint="/communication/notices"
      icon="file-text"
      dateField="notice_date"
    />
  );
}

export function PortalCirculars() {
  return (
    <BroadcastList
      title="Circulars"
      subtitle="Circulars issued to your section of the institution."
      endpoint="/communication/circulars"
      icon="files"
      dateField="issue_date"
    />
  );
}

/**
 * Student profile as seen from inside the portal — the student's own record,
 * or the selected child in the parent portal.
 */
export function PortalProfile() {
  const { studentId, prefix, hasChildren } = useActiveStudent();
  const { data, loading, error, refetch } = useFetch(
    () => api.get(`/students/${studentId}/profile`),
    [studentId],
    { skip: !studentId }
  );

  if (!hasChildren || !studentId) {
    return (
      <Card>
        <EmptyState icon="users" title="No student record" message="No student is linked to this account." />
      </Card>
    );
  }

  if (loading) return <LoadingBlock label="Loading profile" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { student, parents, transport } = data;

  return (
    <>
      <PageHeader title={prefix === '/parent' ? 'Child Profile' : 'My Profile'} subtitle="Personal, academic and contact information." />
      {prefix === '/parent' && <ChildSwitcher />}

      <div className="profile-hero mb-5">
        <Avatar name={student.full_name} src={student.photo} size="lg" />
        <div className="flex-1" style={{ minWidth: 0 }}>
          <h2>{student.full_name}</h2>
          <div className="meta">
            <span>
              <Icon name="id-card" size={13} /> {student.admission_number}
            </span>
            <span>
              <Icon name="layers" size={13} />{' '}
              {student.board === 'CBSE' ? 'CBSE department' : 'State Board department'}
            </span>
            <span>
              <Icon name="grid" size={13} /> {student.class_name} {student.section_name}
            </span>
            <span>
              <Icon name="hash" size={13} /> Roll {student.roll_number || '—'}
            </span>
            <span>
              <Icon name="calendar" size={13} /> {student.academic_year_name}
            </span>
          </div>
        </div>
        <Badge status={student.status}>{student.status}</Badge>
      </div>

      <div className="grid grid-2 mb-4">
        <Card title="Personal information">
          <DetailList
            items={[
              { label: 'Full name', value: student.full_name },
              { label: 'Student ID', value: student.admission_number },
              { label: 'Date of birth', value: formatDate(student.date_of_birth) },
              { label: 'Gender', value: student.gender },
              { label: 'Blood group', value: student.blood_group },
              { label: 'Religion', value: student.religion },
              { label: 'Category', value: student.category },
            ]}
          />
        </Card>

        <Card title="Academic information">
          <DetailList
            items={[
              {
                label: 'Department',
                value: (
                  <Badge tone={student.board === 'CBSE' ? 'purple' : 'info'} dot={false}>
                    {student.board === 'CBSE' ? 'CBSE' : 'State Board'}
                  </Badge>
                ),
              },
              { label: 'Class', value: student.class_name },
              { label: 'Section', value: student.section_name },
              { label: 'Roll number', value: student.roll_number },
              { label: 'Academic year', value: student.academic_year_name },
              { label: 'Admission date', value: formatDate(student.admission_date) },
              { label: 'Mentor', value: student.mentor_name },
              { label: 'Previous school', value: student.previous_school },
            ]}
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Contact information">
          <DetailList
            items={[
              { label: 'Phone', value: student.phone },
              { label: 'Email', value: student.email },
              { label: 'Address', value: student.address },
              { label: 'City', value: student.city },
              { label: 'State', value: student.state },
              { label: 'Pincode', value: student.pincode },
            ]}
          />
        </Card>

        <Card title="Parents & guardians">
          {parents?.length ? (
            <div className="stack">
              {parents.map((parent) => (
                <DetailList
                  key={parent.id}
                  items={[
                    { label: "Father's name", value: parent.father_name },
                    { label: "Mother's name", value: parent.mother_name },
                    { label: 'Contact', value: parent.phone || parent.father_phone },
                    { label: 'Email', value: parent.email },
                    { label: 'Relation', value: parent.relation },
                  ]}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon="users" title="No parent record linked" />
          )}
          {transport && (
            <div className="mt-4" style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div className="stat-label mb-2">Transport</div>
              <div className="text-sm">
                {transport.route_name} · {transport.vehicle_number} · Pickup {transport.pickup_point}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
