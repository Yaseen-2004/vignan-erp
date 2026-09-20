import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.jsx';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant, title, message, duration = 4500) => {
      const id = ++counter.current;
      setToasts((current) => [...current, { id, variant, title, message }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message, 7000),
      warning: (title, message) => push('warning', title, message, 6000),
      info: (title, message) => push('info', title, message),
      /** Convenience for catch blocks. */
      fromError: (error, fallback = 'Something went wrong') =>
        push('error', error?.message || fallback, error?.details?.length ? error.details.map((d) => d.message).join(', ') : undefined, 7000),
      dismiss,
    }),
    [push, dismiss]
  );

  const icons = {
    success: 'check-circle',
    error: 'alert-circle',
    warning: 'alert-triangle',
    info: 'info',
  };
  const tones = { success: 'var(--success-500)', error: 'var(--danger-500)', warning: 'var(--warning-500)', info: 'var(--navy-500)' };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.variant}`}>
            <span className="toast-icon" style={{ color: tones[item.variant] }}>
              <Icon name={icons[item.variant]} size={18} />
            </span>
            <div className="toast-content">
              <div className="toast-title">{item.title}</div>
              {item.message && <div className="toast-message">{item.message}</div>}
            </div>
            <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => dismiss(item.id)} aria-label="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
