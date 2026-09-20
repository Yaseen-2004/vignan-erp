import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDepartment, DEPARTMENTS } from '../context/DepartmentContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { Avatar, Button, Dropdown, EmptyState, timeAgo } from '../components/ui.jsx';
import { NAV, ROLE_LABEL, ROLE_SECTION, mobileNav } from '../nav.js';
import { DeviceNotifications } from '../components/DeviceNotifications.jsx';

export function AppLayout() {
  const { user, logout, can, children, selectedChildId, selectChild } = useAuth();
  const {
    department,
    setDepartment,
    canSelect: canSelectDepartment,
    locked: lockedDepartment,
    short: departmentShort,
  } = useDepartment();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);

  const groups = NAV[user.role] || [];
  const bottomItems = mobileNav(user.role);
  const isPortal = user.role === 'STUDENT' || user.role === 'PARENT';

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Poll the notification centre.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api.get('/communication/notifications?limit=8');
        if (!active) return;
        setNotifications(result.data || []);
        setUnread(result.meta?.unread ?? 0);
      } catch {
        /* the badge is not worth interrupting the user for */
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [location.pathname]);

  const markAllRead = async () => {
    try {
      await api.post('/communication/notifications/read-all');
      setNotifications((current) => current.map((n) => ({ ...n, is_read: 1 })));
      setUnread(0);
    } catch (error) {
      toast.fromError(error);
    }
  };

  const openNotification = async (notification) => {
    if (!notification.is_read) {
      try {
        await api.patch(`/communication/notifications/${notification.id}/read`);
        setUnread((n) => Math.max(0, n - 1));
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, is_read: 1 } : item))
        );
      } catch {
        /* ignore */
      }
    }
    if (notification.link) navigate(resolveLink(notification.link, user.role));
  };

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const current = groups.flatMap((g) => g.items).find((item) => location.pathname.startsWith(item.to));

  return (
    <div className={`app-shell ${isPortal ? 'has-bottom-nav' : ''}`}>
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">V</span>
          <div className="brand-text">
            <strong>Vignan ERP</strong>
            <span>{ROLE_SECTION[user.role]}</span>
          </div>
          <button
            type="button"
            className="icon-btn menu-toggle"
            style={{ color: '#cfe0f4', marginLeft: 'auto' }}
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <nav className="sidebar-scroll">
          {groups.map((group, index) => {
            const visible = group.items.filter((item) => !item.permission || can(item.permission));
            if (!visible.length) return null;
            return (
              <div key={group.title || index}>
                {group.title && <div className="nav-group-title">{group.title}</div>}
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to.split('/').length <= 2}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon name={item.icon} size={17} className="nav-icon" />
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-item" onClick={signOut} style={{ width: '100%', border: 'none', cursor: 'pointer', background: 'transparent' }}>
            <Icon name="log-out" size={17} className="nav-icon" />
            <span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-toggle"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="topbar-title">
            <h1>{current?.label || ROLE_LABEL[user.role]}</h1>
            <p className="hide-sm">
              Vignan Educational Institutions{user.campusName ? ` · ${user.campusName}` : ''}
            </p>
          </div>

          <div className="topbar-actions">
            {lockedDepartment && (
              <span className="user-chip" title="You are assigned to this department" style={{ cursor: 'default' }}>
                <span
                  className={`stat-icon ${lockedDepartment === 'CBSE' ? 'tone-purple' : 'tone-blue'}`}
                  style={{ width: 28, height: 28 }}
                >
                  <Icon name="lock" size={14} />
                </span>
                <span className="who">
                  <strong>{departmentShort}</strong>
                  <span>Assigned</span>
                </span>
              </span>
            )}
            {canSelectDepartment && (
              <Dropdown
                trigger={({ toggle }) => (
                  <button type="button" className="user-chip" onClick={toggle} title="Working department">
                    <span
                      className={`stat-icon ${department === 'CBSE' ? 'tone-purple' : department ? 'tone-blue' : 'tone-navy'}`}
                      style={{ width: 28, height: 28 }}
                    >
                      <Icon name="layers" size={15} />
                    </span>
                    <span className="who">
                      <strong>{departmentShort}</strong>
                      <span>Department</span>
                    </span>
                    <Icon name="chevron-down" size={14} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    <div className="dropdown-head" style={{ display: 'block' }}>
                      <h4>Working department</h4>
                      <span className="text-xs text-muted">
                        Narrows every list, dashboard and new record to one wing of the school.
                      </span>
                    </div>
                    {DEPARTMENTS.map((option) => (
                      <button
                        key={option.value || 'all'}
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          setDepartment(option.value);
                          close();
                        }}
                      >
                        <span
                          className={`stat-icon ${
                            option.value === 'CBSE' ? 'tone-purple' : option.value ? 'tone-blue' : 'tone-navy'
                          }`}
                          style={{ width: 26, height: 26 }}
                        >
                          <Icon name={option.value ? 'layers' : 'grid'} size={13} />
                        </span>
                        <span className="flex-1">{option.label}</span>
                        {option.value === department && <Icon name="check" size={16} />}
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
            )}

            {user.role === 'PARENT' && children.length > 1 && (
              <Dropdown
                trigger={({ toggle }) => (
                  <button type="button" className="user-chip" onClick={toggle}>
                    <Avatar name={children.find((c) => c.id === selectedChildId)?.first_name} size="sm" />
                    <span className="who">
                      <strong>{children.find((c) => c.id === selectedChildId)?.first_name}</strong>
                      <span>Viewing child</span>
                    </span>
                    <Icon name="chevron-down" size={14} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    <div className="dropdown-head">
                      <h4>Switch child</h4>
                    </div>
                    {children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          selectChild(child.id);
                          close();
                        }}
                      >
                        <Avatar name={`${child.first_name} ${child.last_name || ''}`} src={child.photo} size="sm" />
                        <span className="flex-1">
                          <strong style={{ display: 'block' }}>
                            {child.first_name} {child.last_name}
                          </strong>
                          <span className="text-xs text-muted">
                            {child.class_name} {child.section_name}
                          </span>
                        </span>
                        {child.id === selectedChildId && <Icon name="check" size={16} />}
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
            )}

            <Dropdown
              trigger={({ toggle }) => (
                <button type="button" className="icon-btn" onClick={toggle} aria-label="Notifications">
                  <Icon name="bell" size={19} />
                  {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <div className="dropdown-head">
                    <h4>Notifications</h4>
                    {unread > 0 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={markAllRead}>
                        Mark all read
                      </button>
                    )}
                  </div>
                  <DeviceNotifications compact />
                  <div className="dropdown-scroll">
                    {notifications.length ? (
                      notifications.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          className={`feed-item ${notification.is_read ? '' : 'unread'}`}
                          style={{ width: '100%', border: 'none', textAlign: 'left', cursor: 'pointer', background: 'none' }}
                          onClick={() => {
                            openNotification(notification);
                            close();
                          }}
                        >
                          <span className={`feed-icon ${notificationTone(notification.type)}`}>
                            <Icon name={notificationIcon(notification.type)} size={15} />
                          </span>
                          <span className="feed-body">
                            <strong>{notification.title}</strong>
                            {notification.body && <p>{notification.body}</p>}
                            <span className="feed-time">{timeAgo(notification.created_at)}</span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <EmptyState icon="bell" title="No notifications" message="You are all caught up." />
                    )}
                  </div>
                  <div className="dropdown-foot">
                    <Link to="/notifications" className="btn btn-ghost btn-block btn-sm" onClick={close}>
                      View all notifications
                    </Link>
                  </div>
                </>
              )}
            </Dropdown>

            <Dropdown
              trigger={({ toggle }) => (
                <button type="button" className="user-chip" onClick={toggle}>
                  <Avatar name={user.fullName} src={user.photo} size="sm" />
                  <span className="who">
                    <strong>{user.fullName}</strong>
                    <span>{ROLE_LABEL[user.role]}</span>
                  </span>
                  <Icon name="chevron-down" size={14} />
                </button>
              )}
            >
              {({ close }) => (
                <>
                  <div className="dropdown-head" style={{ display: 'block' }}>
                    <strong style={{ display: 'block' }}>{user.fullName}</strong>
                    <span className="text-xs text-muted">{user.email}</span>
                  </div>
                  <Link to="/profile" className="menu-item" onClick={close}>
                    <Icon name="user" size={16} /> My profile
                  </Link>
                  <Link to="/change-password" className="menu-item" onClick={close}>
                    <Icon name="key" size={16} /> Change password
                  </Link>
                  <Link to="/notifications" className="menu-item" onClick={close}>
                    <Icon name="bell" size={16} /> Notifications
                  </Link>
                  <div className="menu-sep" />
                  <button type="button" className="menu-item danger" onClick={signOut}>
                    <Icon name="log-out" size={16} /> Sign out
                  </button>
                </>
              )}
            </Dropdown>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>

      {isPortal && (
        <nav className="bottom-nav">
          {bottomItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={item.icon} size={19} />
              <span>{item.label.split(' ')[0]}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            style={{ flex: 1, border: 'none', background: 'none', color: 'var(--ink-500)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 2px', fontSize: 10.5, fontWeight: 600 }}
          >
            <Icon name="menu" size={19} />
            <span>More</span>
          </button>
        </nav>
      )}
    </div>
  );
}

/**
 * Notification links are stored role-neutrally; point them at the right portal.
 *
 * Students and parents now share one section, so anything still carrying a
 * `/student/` link — every notification written before the merge — is sent to
 * the parent equivalent rather than to a route that no longer exists.
 */
function resolveLink(link, role) {
  if (link.startsWith('/student/')) return link.replace('/student/', '/parent/');
  const prefixes = {
    STUDENT: '/parent',
    PARENT: '/parent',
    TEACHING_STAFF: '/faculty/teaching',
    FINANCIAL_STAFF: '/faculty/financial',
    ADMINISTRATOR: '/administrator',
    ADMIN: '/admin',
  };
  const shared = ['/messages', '/notifications', '/leave', '/profile', '/payslips'];
  if (shared.some((path) => link.startsWith(path))) return link;
  if (link.startsWith('/parent/') || link.startsWith('/faculty/') || link.startsWith('/admin')) {
    return link;
  }
  return `${prefixes[role] || ''}${link}`;
}

function notificationIcon(type) {
  const map = {
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
  };
  return map[type] || 'bell';
}

function notificationTone(type) {
  if (['RESULT_PUBLISHED', 'MARKS_APPROVED', 'LEAVE_APPROVED', 'FEE_PAYMENT', 'PAYSLIP'].includes(type)) return 'tone-green';
  if (['FEE_DUE', 'MARKS_SUBMITTED', 'ATTENDANCE'].includes(type)) return 'tone-amber';
  if (['MARKS_REJECTED', 'LEAVE_REJECTED', 'LIBRARY_FINE'].includes(type)) return 'tone-red';
  if (['NEW_MATERIAL', 'NEW_ASSIGNMENT', 'COURSE_ASSIGNED'].includes(type)) return 'tone-purple';
  return 'tone-navy';
}

export default AppLayout;
