import { userLabel } from './lib/userLabel.js';
import AdminEmployees from './pages/admin/AdminEmployees.jsx';
import React from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, NavLink, Link } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Lottery from './pages/Lottery.jsx';
import MyRecords from './pages/MyRecords.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminLotteries from './pages/admin/AdminLotteries.jsx';
import AdminLotteryDetail from './pages/admin/AdminLotteryDetail.jsx';
import AdminStage from './pages/admin/AdminStage.jsx';
import AdminLogs from './pages/admin/AdminLogs.jsx';
import { ThemeToggle } from './lib/theme.jsx';

export function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">🎡</span>
          <span>
            Luckydraw
            <small>lucky wheel</small>
          </span>
        </Link>
        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>活动广场</NavLink>
          {user && <NavLink to="/me/records" className={({ isActive }) => (isActive ? 'active' : '')}>我的记录</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>后台管理</NavLink>}
        </nav>
        <div className="nav-right">
          <ThemeToggle />
          {user ? (
            <>
              <div className="nav-user">
                <span className="avatar">{userLabel(user).slice(0, 1).toUpperCase()}</span>
                <span className="nav-username" title={userLabel(user)}>{userLabel(user)}</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => { logout(); navigate('/'); }}>退出</button>
            </>
          ) : (
            <>
              <Link className="btn btn-sm btn-ghost" to="/login">登录</Link>
              <Link className="btn btn-sm btn-primary" to="/register">免费注册</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Loading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <div className="muted small">加载中…</div>
    </div>
  );
}

function RequireAuth({ children, admin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function PublicLayout({ children }) {
  return (
    <>
      <div className="app-bg" />
      <div className="page">
        <Nav />
        {children}
      </div>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicLayout><Login /></PublicLayout>} />
      <Route path="/register" element={<PublicLayout><Register /></PublicLayout>} />
      <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
      <Route path="/l/:shareCode" element={<PublicLayout><Lottery /></PublicLayout>} />
      <Route
        path="/me/records"
        element={<PublicLayout><RequireAuth><MyRecords /></RequireAuth></PublicLayout>}
      />
      <Route
        path="/admin"
        element={<RequireAuth admin><AdminLayout /></RequireAuth>}
      >
        <Route index element={<AdminLotteries />} /><Route path="lotteries/:id/employees" element={<AdminEmployees />} />
        <Route path="lotteries/:id" element={<AdminLotteryDetail />} />
        <Route path="lotteries/:id/stage" element={<AdminStage />} />
        <Route path="logs" element={<AdminLogs />} />
      </Route>
      <Route path="*" element={<PublicLayout><div className="container" style={{ padding: '90px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 54 }}>🫥</div>
        <h2>页面走丢了</h2>
        <Link className="btn btn-primary" to="/">回到首页</Link>
      </div></PublicLayout>} />
    </Routes>
  );
}



