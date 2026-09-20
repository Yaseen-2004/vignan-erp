import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { DeviceNotifications } from '../../components/DeviceNotifications.jsx';
import {
  Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs,
  timeAgo, useFetch,
} from '../../components/ui.jsx';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
];

/** Notification centre — read/unread state, timestamp, type and related page. */
export function Notifications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);

  const { data, meta, loading, error, refetch } = useFetch(
    () => api.get(`/communication/notifications${qs({ page, limit: 20, unread: tab === 'unread' ? 'true' : '' })}`),
    [page, tab, nonce]
  );

  const open = async (notification) => {
    if (!notification.is_read) {
      try {
        await api.patch(`/communication/notifications/${notification.id}/read`);
      } catch {
        /* navigating still makes sense */
      }
    }
    if (notification.link) navigate(resolve(notification.link, user.role));
    else setNonce((n) => n + 1);
  };

  const markAll = async () => {
    try {
      const result = await api.post('/communication/notifications/read-all');
      toast.success('All notifications marked read', `${result.data.updated} updated`);
      setNonce((n) => n + 1);
    } catch (markError) {
      toast.fromError(markError);
    }
  };

  const remove = async (id, event) => {
    event.stopPropagation();
    try {
      await api.delete(`/communication/notifications/${id}`);
      setNonce((n) => n + 1);
    } catch (deleteError) {
      toast.fromError(deleteError);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Announcements, results, fees, materials and everything else addressed to you."
        actions={
          meta?.unread > 0 && (
            <Button icon="check" onClick={markAll}>
              Mark all read
            </Button>
          )
        }
      />

      {/* Where someone already thinking about notifications will look for it. */}
      <Card title="Notifications on this device" className="mb-4">
        <DeviceNotifications />
      </Card>

      <Tabs
        tabs={TABS.map((item) => ({ ...item, count: item.key === 'unread' ? meta?.unread : undefined }))}
        active={tab}
        onChange={(next) => {
          setTab(next);
          setPage(1);
        }}
        pill
      />

      <Card bodyClass="flush" className="mt-4">
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton variant="row" count={6} />
          </div>
        ) : error ? (
          <div style={{ padding: 20 }}>
            <ErrorState error={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon="bell"
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications'}
            message="You are all caught up."
          />
        ) : (
          <>
            <div className="feed">
              {data.map((notification) => (
                <div
                  key={notification.id}
                  className={`feed-item ${notification.is_read ? '' : 'unread'}`}
                  onClick={() => open(notification)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`feed-icon ${tone(notification.type)}`}>
                    <Icon name={icon(notification.type)} size={15} />
                  </span>
                  <div className="feed-body">
                    <strong>{notification.title}</strong>
                    {notification.body && <p>{notification.body}</p>}
                    <span className="feed-time">
                      <Badge tone="neutral" dot={false}>
                        {String(notification.type).replace(/_/g, ' ')}
                      </Badge>{' '}
                      {timeAgo(notification.created_at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(event) => remove(notification.id, event)}
                    aria-label="Delete notification"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
            {meta && <Pagination {...meta} onChange={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

/** Notification links are role-neutral; point them at the caller's portal. */
function resolve(link, role) {
  const shared = ['/messages', '/notifications', '/leave', '/profile', '/payslips', '/receipts', '/report-card'];
  if (shared.some((path) => link.startsWith(path))) return link;
  // Students and parents share one section now; anything written before the
  // merge still carries a /student/ link and belongs to the parent.
  if (link.startsWith('/student/')) return link.replace('/student/', '/parent/');
  if (
    link.startsWith('/parent') ||
    link.startsWith('/faculty') ||
    link.startsWith('/admin')
  ) {
    return link;
  }
  const prefixes = {
    STUDENT: '/parent',
    PARENT: '/parent',
    TEACHING_STAFF: '/faculty/teaching',
    FINANCIAL_STAFF: '/faculty/financial',
    ADMINISTRATOR: '/administrator',
    ADMIN: '/admin',
  };
  return `${prefixes[role] || ''}${link}`;
}

const icon = (type) =>
  ({
    ANNOUNCEMENT: 'megaphone',
    NOTICE: 'file-text',
    CIRCULAR: 'files',
    RESULT_PUBLISHED: 'award',
    FEE_DUE: 'wallet',
    FEE_PAYMENT: 'receipt',
    NEW_MATERIAL: 'files',
    NEW_ASSIGNMENT: 'clipboard',
    ATTENDANCE: 'calendar-check',
    MESSAGE: 'mail',
    MARKS_SUBMITTED: 'clipboard-check',
    MARKS_APPROVED: 'check-circle',
    MARKS_REJECTED: 'x-circle',
    TIMETABLE_UPDATED: 'clock',
    COURSE_ASSIGNED: 'book-open',
    EXAM_SCHEDULED: 'calendar',
    LEAVE_APPROVED: 'check-circle',
    LEAVE_REJECTED: 'x-circle',
    PAYSLIP: 'banknote',
    MENTORING: 'compass',
    LIBRARY_FINE: 'library',
    PROMOTION: 'trending-up',
  })[type] || 'bell';

const tone = (type) => {
  if (['RESULT_PUBLISHED', 'MARKS_APPROVED', 'LEAVE_APPROVED', 'FEE_PAYMENT', 'PAYSLIP'].includes(type)) return 'tone-green';
  if (['FEE_DUE', 'MARKS_SUBMITTED', 'ATTENDANCE'].includes(type)) return 'tone-amber';
  if (['MARKS_REJECTED', 'LEAVE_REJECTED', 'LIBRARY_FINE'].includes(type)) return 'tone-red';
  if (['NEW_MATERIAL', 'NEW_ASSIGNMENT', 'COURSE_ASSIGNED'].includes(type)) return 'tone-purple';
  return 'tone-navy';
};

export default Notifications;
