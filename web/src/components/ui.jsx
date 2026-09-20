import { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from './Icon.jsx';

/* ------------------------------------------------------------- buttons */
export function Button({
  variant = 'secondary',
  size,
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}) {
  return (
    <button
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${children ? '' : ' btn-icon'} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- cards */
export function Card({ title, hint, actions, children, className = '', bodyClass = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-head">
          <div className="flex-1" style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions && <div className="row" style={{ gap: 8 }}>{actions}</div>}
        </header>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------- stat tiles */
export function Stat({ label, value, icon, tone = 'navy', meta, trend, onClick }) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      className="stat"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit' } : undefined}
    >
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className={`stat-icon tone-${tone}`}>
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {(meta || trend) && (
        <div className="stat-meta">
          {trend && (
            <span className={`stat-trend ${trend.direction}`}>
              <Icon name={trend.direction === 'up' ? 'trending-up' : 'trending-up'} size={12} /> {trend.value}
            </span>
          )}
          {meta && <span>{meta}</span>}
        </div>
      )}
    </Wrapper>
  );
}

/* -------------------------------------------------------------- badges */
const STATUS_TONE = {
  ACTIVE: 'success', PRESENT: 'success', PAID: 'success', APPROVED: 'success', PASS: 'success',
  PUBLISHED: 'success', SUCCESS: 'success', RETURNED: 'success', COMPLETED: 'success', IN_USE: 'success',
  PENDING: 'warning', PARTIAL: 'warning', SUBMITTED: 'warning', LATE: 'warning', DRAFT: 'neutral',
  PROCESSED: 'info', SCHEDULED: 'info', ISSUED: 'info', ONGOING: 'info', LEAVE: 'info', ON_LEAVE: 'info',
  INACTIVE: 'neutral', ARCHIVED: 'neutral', CLOSED: 'neutral', UPCOMING: 'info', HALF_DAY: 'warning',
  ABSENT: 'danger', OVERDUE: 'danger', REJECTED: 'danger', FAIL: 'danger', FAILED: 'danger',
  SUSPENDED: 'danger', LOST: 'danger', DAMAGED: 'danger', CANCELLED: 'danger', RESIGNED: 'danger',
  RESULTS_PUBLISHED: 'success', TRANSFERRED: 'neutral', ALUMNI: 'purple', WAIVED: 'purple',
  URGENT: 'danger', HIGH: 'warning', NORMAL: 'info', LOW: 'neutral',
  TEACHING: 'info', FINANCIAL: 'purple', MAINTENANCE: 'warning',
};

export function Badge({ children, tone, status, dot = true }) {
  const resolved = tone || STATUS_TONE[String(status ?? children).toUpperCase()] || 'neutral';
  const label = String(children ?? status ?? '').replace(/_/g, ' ');
  return <span className={`badge badge-${resolved}${dot ? ' badge-dot' : ''}`}>{label}</span>;
}

/* --------------------------------------------------------------- forms */
export function Field({ label, required, error, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error && <div className="field-error">{error}</div>}
      {hint && !error && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Input({ error, className = '', ...rest }) {
  return <input className={`input ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export function Textarea({ error, className = '', ...rest }) {
  return <textarea className={`textarea ${error ? 'error' : ''} ${className}`} {...rest} />;
}

export function Select({ error, options = [], placeholder, className = '', children, ...rest }) {
  return (
    <select className={`select ${error ? 'error' : ''} ${className}`} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => {
        const value = typeof option === 'object' ? option.value : option;
        const label = typeof option === 'object' ? option.label : String(option).replace(/_/g, ' ');
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
      {children}
    </select>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* -------------------------------------------------------------- modals */
export function Modal({ open, onClose, title, subtitle, children, footer, size = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', variant = 'danger', onConfirm, onCancel, loading }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="narrow"
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-muted">{message}</p>
    </Modal>
  );
}

/* ---------------------------------------------------------- feedback */
export function EmptyState({ icon = 'inbox', title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="error-state">
      <Icon name="alert-circle" size={20} />
      <div className="flex-1">
        <strong>Could not load this data</strong>
        <p className="text-sm">{error?.message || 'An unexpected error occurred.'}</p>
        {onRetry && (
          <Button size="sm" className="mt-3" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function Skeleton({ variant = 'text', width, height, count = 1, style }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={`skeleton skeleton-${variant}`} style={{ width, height, ...style }} />
      ))}
    </>
  );
}

export function StatSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-stats">
      <Skeleton variant="stat" count={count} />
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function LoadingBlock({ label = 'Loading' }) {
  return (
    <div className="empty">
      <Spinner size={26} />
      <p className="text-muted">{label}...</p>
    </div>
  );
}

/* ------------------------------------------------------------ avatars */
export function Avatar({ name, src, size = '', className = '' }) {
  const initials = String(name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (
    <span className={`avatar ${size} ${className}`}>
      {src ? <img src={src} alt={name || ''} loading="lazy" /> : initials}
    </span>
  );
}

/* --------------------------------------------------------- pagination */
export function Pagination({ page, pages, total, limit, onChange }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const numbers = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i += 1) numbers.push(i);

  return (
    <div className="pagination">
      <span>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total.toLocaleString()}</strong>
      </span>
      {pages > 1 && (
        <div className="pagination-controls">
          <button className="page-btn" onClick={() => onChange(1)} disabled={page === 1} aria-label="First page">
            <Icon name="chevrons-left" size={14} />
          </button>
          <button className="page-btn" onClick={() => onChange(page - 1)} disabled={page === 1} aria-label="Previous page">
            <Icon name="chevron-left" size={14} />
          </button>
          {numbers.map((number) => (
            <button
              key={number}
              className={`page-btn ${number === page ? 'active' : ''}`}
              onClick={() => onChange(number)}
            >
              {number}
            </button>
          ))}
          <button className="page-btn" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page">
            <Icon name="chevron-right" size={14} />
          </button>
          <button className="page-btn" onClick={() => onChange(pages)} disabled={page >= pages} aria-label="Last page">
            <Icon name="chevrons-right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- media query */
/**
 * Follow a CSS media query from JavaScript.
 *
 * Some layouts cannot be expressed as a restyle of the same markup — a week
 * grid that becomes a day list, a table that becomes cards — so the component
 * has to know the shape of the screen. Everything that *can* be done in the
 * stylesheet should be; reach for this only when the markup itself differs.
 *
 * Starts false where there is no window (server rendering) and corrects itself
 * on mount, so it never throws during a render pass.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/* ---------------------------------------------------------- table wrap */
/**
 * The container every hand-written table sits in.
 *
 * On a wide screen it is just a horizontal scroller. On a phone the table is
 * restacked into one card per row (see `.table-wrap` in the stylesheet), and a
 * stacked cell only makes sense if it says which column it came from — so this
 * copies each column heading onto its cells as `data-label`, which the CSS
 * then prints in front of the value.
 *
 * Doing it here rather than by hand keeps the labels honest: they cannot drift
 * out of step with the headers, and a table written tomorrow gets it for free.
 */
export function TableWrap({ children, className = '', ...rest }) {
  const ref = useRef(null);

  // No dependency list on purpose: rows change as data loads, sorts and pages
  // change, and the labels have to follow. Setting an attribute does not
  // re-render, so this cannot loop.
  useEffect(() => {
    const table = ref.current?.querySelector('table');
    if (!table) return;
    const labels = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!labels.length) return;
    for (const row of table.querySelectorAll('tbody tr')) {
      let column = 0;
      for (const cell of row.children) {
        const span = cell.colSpan || 1;
        const label = span === 1 ? labels[column] : '';
        // A cell spanning several columns (an empty state, a totals row) has no
        // single heading to carry, so it stays unlabelled and renders full width.
        if (label) cell.setAttribute('data-label', label);
        else cell.removeAttribute('data-label');
        column += span;
      }
    }
  });

  return (
    <div ref={ref} className={`table-wrap ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- tabs */
export function Tabs({ tabs, active, onChange, pill = false }) {
  return (
    <div className={pill ? 'pill-tabs' : 'tabs'} role="tablist">
      {tabs.map((tab) => {
        const key = tab.key ?? tab;
        const label = tab.label ?? tab;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active === key}
            className={`${pill ? 'pill-tab' : 'tab'} ${active === key ? 'active' : ''}`}
            onClick={() => onChange(key)}
          >
            {label}
            {tab.count !== undefined && <span className="text-subtle"> ({tab.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ details */
export function DetailList({ items }) {
  return (
    <dl className="detail-list">
      {items
        .filter((item) => item && item.value !== undefined && item.value !== null && item.value !== '')
        .map((item) => (
          <div className="detail-row" key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
    </dl>
  );
}

/* ------------------------------------------------------------- meters */
export function Meter({ label, value, max = 100, tone, suffix = '%' }) {
  const percent = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const resolvedTone = tone || (percent >= 75 ? 'success' : percent >= 50 ? 'warning' : 'danger');
  return (
    <div className="meter-row">
      <span className="label truncate">{label}</span>
      <div className="progress">
        <div className={`progress-bar ${resolvedTone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="value">
        {typeof value === 'number' ? value.toFixed(value % 1 ? 1 : 0) : value}
        {suffix}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------- dropdown */
export function Dropdown({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className="dropdown" style={align === 'left' ? { right: 'auto', left: 0 } : undefined}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ helpers */
export const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    Number(value || 0)
  );

export const formatCurrencyExact = (value) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(
    Number(value || 0)
  );

export const formatNumber = (value) => new Intl.NumberFormat('en-IN').format(Number(value || 0));

export function formatDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', options);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return 'just now';
  const units = [
    [60, 'min'],
    [3600, 'hr'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
  ];
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} w ago`;
  return formatDate(value);
}

export const fileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (!size) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

export const initials = (name) =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

/** Debounce a changing value (used by search inputs). */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Small data-fetching hook with loading / error / refetch.
 *
 * `loading` is true from the moment the fetch becomes active until its first
 * result or error — including the render in which `skip` flips to false. The
 * effect that starts the request runs *after* that render, so without this a
 * caller would briefly see `loading === false` with `data === null` and crash
 * on the first dereference.
 *
 * Loading is tracked with an explicit `settled` flag rather than inferred from
 * `data === null`, because an endpoint may legitimately resolve to null.
 */
export function useFetch(fetcher, deps = [], { skip = false } = {}) {
  // `settled` means "a request has finished". A skipped fetch is never settled,
  // so the instant `skip` turns false the hook already reports loading, without
  // waiting for the effect to run.
  const [state, setState] = useState({ data: null, meta: null, settled: false, error: null });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (skip) {
      setState({ data: null, meta: null, settled: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, settled: false, error: null }));
    Promise.resolve(fetcherRef.current())
      .then((result) => {
        if (!cancelled) {
          setState({ data: result?.data ?? result, meta: result?.meta ?? null, settled: true, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, meta: null, settled: true, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, skip]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  const { settled, ...rest } = state;
  return { ...rest, loading: !skip && !settled, refetch };
}
