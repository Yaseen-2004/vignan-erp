import { useAuth } from '../../context/AuthContext.jsx';
import { Avatar } from '../../components/ui.jsx';

/**
 * Child selector for the parent portal.
 * Every parent screen reads `selectedChildId`, so switching here changes the
 * data on the whole portal — and the API independently refuses any child that
 * is not linked to this parent.
 */
export function ChildSwitcher({ className = 'mb-5' }) {
  const { children, selectedChildId, selectChild } = useAuth();
  if (children.length <= 1) return null;

  return (
    <div className={className}>
      <div className="text-xs text-muted fw-600 mb-3" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Viewing
      </div>
      <div className="child-switcher">
        {children.map((child) => (
          <button
            key={child.id}
            type="button"
            className={`child-card ${child.id === selectedChildId ? 'active' : ''}`}
            onClick={() => selectChild(child.id)}
          >
            <Avatar name={`${child.first_name} ${child.last_name || ''}`} src={child.photo} />
            <span style={{ minWidth: 0 }}>
              <strong className="truncate">
                {child.first_name} {child.last_name}
              </strong>
              <span>
                {child.class_name} {child.section_name} · {child.admission_number}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ChildSwitcher;
