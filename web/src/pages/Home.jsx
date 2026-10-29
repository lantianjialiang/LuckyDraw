import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../lib/auth.jsx';

export default function Home() {
  const [lotteries, setLotteries] = useState([]);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    setLotteries([]);
    if (!user) { setLoading(false); return; }
    setLoading(true);
    api.get('/api/lotteries')
      .then((d) => { if (active) setLotteries(d.lotteries || []); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);
  const go = (e) => {
    e.preventDefault();
    const v = code.trim();
    if (!v) return;
    // 支持直接粘贴完整链接
    const m = v.match(/\/l\/([A-Za-z0-9]+)/);
    navigate(`/l/${m ? m[1] : v}`);
  };

  return (
    <main className="container" style={{ flex: 1 }}>
      <section className="hero">
        <div className="hero-eyebrow">✦ 转动命运 · 好运不设上限</div>
        <h1>
          每一次转动
          <br />
          都是<span className="gold">命运的偏爱</span>
        </h1>
        <p>输入邀请码进入活动现场，转动转盘，赢取属于你的那份惊喜。</p>

        <form className="code-entry" onSubmit={go}>
          <input
            className="input"
            placeholder="输入 8 位活动码"
            value={code}
            maxLength={64}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">进入活动</button>
        </form>

        {!user && (
          <div className="small muted" style={{ marginTop: 16 }}>
            还没有账号？<Link to="/register" style={{ color: 'var(--gold)' }}>立即注册</Link>，30 秒开启你的第一场抽奖
          </div>
        )}
      </section>

      {user && <section style={{ paddingTop: 18 }}>
        <div className="flex" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="section-title">正在进行的活动</h2>
            <p className="section-sub" style={{ marginBottom: 0 }}>
              实时奖池 · 概率透明 · 每人一次
            </p>
          </div>
          <div className="spacer" />
          {user?.role === 'admin' && <Link className="btn btn-sm" to="/admin">进入后台 →</Link>}
        </div>

        {loading ? (
          <div className="lottery-grid">
            {[0, 1, 2].map((i) => <div key={i} className="card skeleton" style={{ height: 186 }} />)}
          </div>
        ) : lotteries.length === 0 ? (
          <div className="card empty">
            <span className="empty-icon">🎪</span>
            暂无进行中的活动
            <div className="small" style={{ marginTop: 8, color: 'var(--muted-2)' }}>
              管理员发布活动后，这里会实时出现
            </div>
          </div>
        ) : (
          <div className="lottery-grid">
            {lotteries.map((l) => (
              <Link key={l.id} to={`/l/${l.shareCode}`} className="card lottery-card">
                <div className="flex">
                  <span className="badge badge-live"><i className="badge-dot" />进行中</span>
                  <div className="spacer" />
                  <span className="small mono muted">{l.shareCode}</span>
                </div>
                <h3>{l.title}</h3>
                <p>{l.description || '暂无活动说明'}</p>
                <div className="lottery-meta">
                  <span><strong>{l.prizeCount}</strong> 个奖项</span>
                  <span><strong>{l.poolRemaining}</strong> 份剩余</span>
                  {l.endAt && <span style={{ marginLeft: 'auto' }}>截止 {new Date(l.endAt).toLocaleDateString('zh-CN')}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>}
    </main>
  );
}


