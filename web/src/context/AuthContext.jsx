import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setAccessToken, setUnauthorizedHandler } from '../api/client.js';

import { readSetting, writeSetting } from '../lib/storage.js';
/** Exported so tests can supply a stub session without a live API. */
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [children_, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((data) => {
    setUser(data.user);
    if (data.user?.role === 'PARENT') {
      const list = data.children || [];
      setChildren(list);
      setSelectedChildId((current) => {
        if (current && list.some((c) => c.id === current)) return current;
        const stored = Number(readSetting('vignan.child', 0));
        if (stored && list.some((c) => c.id === stored)) return stored;
        return list[0]?.id ?? null;
      });
    } else {
      setChildren([]);
      setSelectedChildId(null);
    }
  }, []);

  // Restore the session on load: the refresh cookie survives a page reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.refresh();
        const me = await api.get('/auth/me');
        if (!cancelled) applySession(me.data);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
  }, []);

  const login = useCallback(
    // `portal` names the door the person chose on the login page; the API
    // refuses the sign-in if their role does not belong to it.
    async (login_, password, portal) => {
      const result = await api.post('/auth/login', { login: login_, password, portal: portal || undefined });
      setAccessToken(result.data.accessToken);
      applySession(result.data);
      return result.data.user;
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* signing out locally is what matters */
    }
    setAccessToken(null);
    setUser(null);
    setChildren([]);
    setSelectedChildId(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.get('/auth/me');
    applySession(me.data);
    return me.data.user;
  }, [applySession]);

  const selectChild = useCallback((id) => {
    setSelectedChildId(id);
    writeSetting('vignan.child', id);
  }, []);

  /** Permission check mirroring the server: never the only gate, just the UI. */
  const can = useCallback(
    (...codes) => {
      if (!user) return false;
      if (user.role === 'ADMIN') return true;
      return codes.flat().some((code) => user.permissions.includes(code));
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      can,
      role: user?.role ?? null,
      profile: user?.profile ?? null,
      children: children_,
      selectedChildId,
      selectedChild: children_.find((c) => c.id === selectedChildId) ?? null,
      selectChild,
    }),
    [user, loading, login, logout, refreshUser, can, children_, selectedChildId, selectChild]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
