import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'ld.theme';
const ThemeCtx = createContext(null);

const systemTheme = () =>
  window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : systemTheme();
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === 'light' || t === 'dark' ? t : systemTheme()), []);
  const toggle = useCallback(() => setThemeState((p) => (p === 'light' ? 'dark' : 'light')), []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx) || { theme: 'dark', setTheme: () => {}, toggle: () => {} };
}

/** 顶栏的浅色/深色切换按钮 */
export function ThemeToggle({ compact = false }) {
  const { theme, toggle } = useTheme();
  const isLight = theme === 'light';
  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? 'compact' : ''}`}
      onClick={toggle}
      title={isLight ? '切换到深色模式' : '切换到浅色模式'}
      aria-label={isLight ? '切换到深色模式' : '切换到浅色模式'}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-thumb" />
      </span>
      {!compact && <span className="small">{isLight ? '浅色' : '深色'}</span>}
    </button>
  );
}
