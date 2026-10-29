import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken('');
      setUser(null);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    if (!getToken()) { setLoading(false); return undefined; }
    api.get('/api/auth/me')
      .then((d) => { if (alive) setUser(d.user); })
      .catch(() => { setToken(''); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (username, password) => {
    const d = await api.post('/api/auth/login', { username, password });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (username, password) => {
    const d = await api.post('/api/auth/register', { username, password });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setUser(null);
  }, []);

  /** 年会签到用：后端直接发 token，这里接管登录态 */
  const applyToken = useCallback(async (token) => {
    setToken(token);
    const d = await api.get('/api/auth/me');
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, applyToken, isAdmin: user?.role === 'admin' }),
    [user, loading, login, register, logout, applyToken],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
