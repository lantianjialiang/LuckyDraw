import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/';
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { toast('两次输入的密码不一致', 'error'); return; }
    setBusy(true);
    try {
      const user = await register(form.username.trim(), form.password);
      toast(`注册成功，欢迎 ${user.username}`, 'success');
      navigate(redirect, { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card rise-in">
        <h2>创建账号</h2>
        <p>只需一个用户名，就能参与所有活动。</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>用户名</label>
            <input className="input" autoFocus value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="3-32 个字符" />
          </div>
          <div className="field">
            <label>密码</label>
            <input className="input" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="至少 6 位" />
          </div>
          <div className="field">
            <label>确认密码</label>
            <input className="input" type="password" value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              placeholder="再输一次" />
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
            {busy ? '创建中…' : '注册并登录'}
          </button>
        </form>
        <div className="auth-alt">
          已有账号？<Link to={`/login?redirect=${encodeURIComponent(redirect)}`}>直接登录</Link>
        </div>
      </div>
    </div>
  );
}
