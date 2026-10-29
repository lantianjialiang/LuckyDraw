import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await login(form.username.trim(), form.password);
      toast(`欢迎回来，${user.username}`, 'success');
      navigate(user.role === 'admin' && redirect === '/' ? '/admin' : redirect, { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card rise-in">
        <h2>登录账号</h2>
        <p>登录后即可参与抽奖，并随时查看你的中奖记录。</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>用户名</label>
            <input
              className="input" autoFocus autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="请输入用户名"
            />
          </div>
          <div className="field">
            <label>密码</label>
            <input
              className="input" type="password" autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="请输入密码"
            />
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <div className="auth-alt">
          还没有账号？<Link to={`/register?redirect=${encodeURIComponent(redirect)}`}>立即注册</Link>
        </div>
        <div className="demo-tip">
          演示账号：<b>demo / demo123</b>
          <br />
          管理员：<b>admin / admin123</b>
        </div>
      </div>
    </div>
  );
}
