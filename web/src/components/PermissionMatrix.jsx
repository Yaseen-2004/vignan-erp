import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Button, Input } from './ui.jsx';

/**
 * Permission matrix editor.
 *
 * Two modes:
 *  - `mode="role"`     the selected set IS the role's permissions.
 *  - `mode="override"` the role grants a baseline; each toggle records an
 *                      explicit ALLOW (added) or DENY (removed) for one user.
 */
export function PermissionMatrix({
  catalogue,
  selected = [],
  baseline = [],
  mode = 'role',
  onChange,
  disabled = false,
  lockedModules = [],
}) {
  const [search, setSearch] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const baselineSet = useMemo(() => new Set(baseline), [baseline]);

  const visible = useMemo(() => {
    if (!search.trim()) return catalogue;
    const term = search.toLowerCase();
    return catalogue
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter(
          (p) => p.code.includes(term) || group.label.toLowerCase().includes(term)
        ),
      }))
      .filter((group) => group.permissions.length);
  }, [catalogue, search]);

  const toggle = (code) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next]);
  };

  const toggleModule = (group, on) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    for (const permission of group.permissions) {
      if (on) next.add(permission.code);
      else next.delete(permission.code);
    }
    onChange([...next]);
  };

  const totalSelected = selected.length;

  return (
    <div>
      <div className="row row-wrap mb-4" style={{ gap: 10 }}>
        <div className="search flex-1" style={{ position: 'relative', minWidth: 200 }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-subtle)' }} />
          <Input
            placeholder="Filter permissions..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>
        <span className="text-sm text-muted nowrap">
          <strong>{totalSelected}</strong> selected
        </span>
        {!disabled && (
          <>
            <Button
              size="sm"
              onClick={() => onChange(catalogue.flatMap((g) => g.permissions.map((p) => p.code)))}
            >
              Select all
            </Button>
            <Button size="sm" onClick={() => onChange([])}>
              Clear
            </Button>
          </>
        )}
      </div>

      {mode === 'override' && (
        <p className="field-hint mb-4">
          Ticked permissions are granted. A permission the role normally grants that you untick is recorded as an
          explicit denial for this user only.
        </p>
      )}

      {visible.map((group) => {
        const locked = lockedModules.includes(group.module);
        const allOn = group.permissions.every((p) => selectedSet.has(p.code));
        const someOn = group.permissions.some((p) => selectedSet.has(p.code));

        return (
          <div className="perm-module" key={group.module}>
            <div className="perm-module-head">
              <div>
                <strong>{group.label}</strong>
                <span className="text-xs text-muted"> · {group.module}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="text-xs text-muted">
                  {group.permissions.filter((p) => selectedSet.has(p.code)).length}/{group.permissions.length}
                </span>
                {!disabled && !locked && (
                  <Button size="sm" variant="ghost" onClick={() => toggleModule(group, !allOn)}>
                    {allOn ? 'None' : someOn ? 'All' : 'All'}
                  </Button>
                )}
              </div>
            </div>
            <div className="perm-grid">
              {group.permissions.map((permission) => {
                const on = selectedSet.has(permission.code);
                const inBaseline = baselineSet.has(permission.code);
                return (
                  <button
                    key={permission.code}
                    type="button"
                    className={`perm-toggle ${on ? 'on' : ''} ${disabled || locked ? 'locked' : ''}`}
                    onClick={() => !locked && toggle(permission.code)}
                    disabled={disabled || locked}
                    title={permission.description || permission.code}
                  >
                    <Icon name={on ? 'check-circle' : 'x-circle'} size={13} />
                    <span className="truncate">{permission.action}</span>
                    {mode === 'override' && inBaseline && !on && (
                      <span className="text-xs" style={{ color: 'var(--danger-700)' }} title="Denied for this user">
                        denied
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!visible.length && <p className="text-muted text-center mt-5">No permissions match that filter.</p>}
    </div>
  );
}

export default PermissionMatrix;
