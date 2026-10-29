import React from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { useToast } from '../../lib/toast.jsx';
import { sfx } from '../../lib/sound.js';
import { ThemeToggle } from '../../lib/theme.jsx';

export default function AdminLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [soundOn, setSoundOn] = React.useState(sfx.enabled);

  if (!isAdmin) {
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card card-pad center">
          <h2>无权访问</h2>
          <p className="muted small">该页面仅限管理员</p>
          <Link className="btn btn-primary" to="/">回到首页</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="app-bg" />
      <div className="admin-shell" style={{ position: 'relative', zIndex: 1 }}>
        <aside className="admin-side">
          <div className="brand">
            <span className="brand-mark">🎡</span>
            <span>
              Luckydraw
              <small>admin console</small>
            </span>
          </div>

          <div className="side-label">运营</div>
          <NavLink to="/admin" end className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span>🎪</span> 抽奖活动
          </NavLink>
          <NavLink to="/admin/logs" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <span>📜</span> 操作日志
          </NavLink>

          <div className="side-label">前台</div>
          <Link to="/" className="side-link"><span>🌐</span> 活动广场</Link>
          <NavLink to="/me/records" className="side-link"><span>🎟️</span> 我的记录</NavLink>

          <div className="side-foot">
            <div className="flex" style={{ marginBottom: 12, gap: 8 }}>
              <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 12.5 }}>{user.username}</div>
                <div style={{ fontSize: 10.5 }}>管理员</div>
              </div>
            </div>
            <button
              className="btn btn-sm btn-ghost btn-block"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                sfx.setEnabled(next);
                toast(next ? '音效已开启' : '音效已静音');
              }}
            >
              {soundOn ? '🔊 音效开启' : '🔇 已静音'}
            </button>
<button
              className="btn btn-sm btn-ghost btn-block"
              style={{ marginTop: 6 }}
              onClick={() => { logout(); navigate('/'); }}
            >
              退出登录
            </button>
          </div>
        </aside>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}



