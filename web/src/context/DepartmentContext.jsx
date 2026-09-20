import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

import { readSetting, writeSetting } from '../lib/storage.js';
/**
 * The department (examination board) an Admin or Administrator is currently
 * working in.
 *
 * The school runs a State Board wing and a CBSE wing. Both roles have complete
 * access to both, so this is a working scope rather than a restriction: pick a
 * department and every list, dashboard and new record narrows to it; pick
 * "All departments" and the whole school is in view again.
 *
 * Nothing here grants access. The API applies the same `board` filter it would
 * apply to any request, and still enforces role, permission and ownership on
 * top of it.
 */
const DepartmentContext = createContext(null);

const STORAGE_KEY = 'vignan.department';

export const DEPARTMENTS = [
  { value: '', label: 'All departments', short: 'All' },
  { value: 'STATE', label: 'State Board', short: 'State' },
  { value: 'CBSE', label: 'CBSE', short: 'CBSE' },
];

/** Roles that choose a department to work in. Everyone else is scoped already. */
const SELECTS_DEPARTMENT = ['ADMIN', 'ADMINISTRATOR'];

export function DepartmentProvider({ children }) {
  const { user } = useAuth();

  /**
   * The department this account is confined to, set by an Admin. Null means
   * unrestricted — an Admin always is, and so is an Administrator assigned to
   * BOTH. This only shapes the picker; the API narrows every query regardless,
   * so a stale value here cannot widen anyone's access.
   */
  const locked = user?.board || null;
  const canSelect = SELECTS_DEPARTMENT.includes(user?.role) && !locked;

  const [department, setDepartmentState] = useState(() => {
    try {
      const stored = readSetting(STORAGE_KEY);
      return DEPARTMENTS.some((d) => d.value === stored) ? stored : '';
    } catch {
      return '';
    }
  });

  // A role that does not choose a department always works across the school;
  // its own scoping (assignment, ownership) is what limits it. An account
  // confined to one department is pinned to it instead.
  useEffect(() => {
    if (locked) {
      if (department !== locked) setDepartmentState(locked);
    } else if (!canSelect && department) {
      setDepartmentState('');
    }
  }, [canSelect, locked, department]);

  const setDepartment = useCallback((value) => {
    setDepartmentState(value);
    try {
      writeSetting(STORAGE_KEY, value);
    } catch {
      /* a private window simply loses the preference */
    }
  }, []);

  const value = useMemo(() => {
    const active = locked || (canSelect ? department : '');
    return {
      department: active,
      setDepartment,
      canSelect,
      /** The department this account cannot see past, or null. */
      locked,
      /** Merge into a query object; empty when no department is selected. */
      params: active ? { board: active } : {},
      label: DEPARTMENTS.find((d) => d.value === active)?.label ?? 'All departments',
      short: DEPARTMENTS.find((d) => d.value === active)?.short ?? 'All',
      /** Narrow a lookup list (classes, sections, courses) to the selection. */
      filter: (list) => (active ? (list || []).filter((item) => !item.board || item.board === active) : list || []),
    };
  }, [canSelect, locked, department, setDepartment]);

  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}

export function useDepartment() {
  const context = useContext(DepartmentContext);
  // Portals that never select a department can call this safely.
  return (
    context ?? {
      department: '',
      setDepartment: () => {},
      canSelect: false,
      locked: null,
      params: {},
      label: 'All departments',
      short: 'All',
      filter: (list) => list || [],
    }
  );
}
