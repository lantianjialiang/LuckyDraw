import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const STATUS = {
  won: { cls: 'badge-won', text: '待领取' },
  claimed: { cls: 'badge-claimed', text: '已领取' },
  revoked: { cls: 'badge-revoked', text: '已撤回' },
};

export default function MyRecords() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/me/records')
      .then((d) => setRecords(d.records || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const wonCount = records.filter((r) => r.prizeTypeSnapshot !== 'none' && r.status !== 'revoked').length;

  return (
    <main className="container" style={{ flex: 1, paddingTop: 38, paddingBottom: 70 }}>
      <div className="admin-head">
        <div>
          <h1>我的中奖记录</h1>
          <p>共 {records.length} 次参与，其中 {wonCount} 次中奖</p>
        </div>
        <div className="spacer" />
        <Link className="btn btn-sm" to="/">去参与活动 →</Link>
      </div>

      {loading ? (
        <div className="card skeleton" style={{ height: 200 }} />
      ) : records.length === 0 ? (
        <div className="card empty">
          <span className="empty-icon">🎟️</span>
          还没有参与记录
          <div className="small" style={{ marginTop: 10 }}>
            <Link to="/" style={{ color: 'var(--gold)' }}>去活动广场看看 →</Link>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {records.map((r) => {
            const st = STATUS[r.status] || STATUS.won;
            const isNone = r.prizeTypeSnapshot === 'none';
            return (
              <div key={r.id} className="card card-pad flex" style={{ gap: 16 }}>
                <div
                  className="prize-chip"
                  style={{ width: 48, height: 48, fontSize: 21, opacity: r.status === 'revoked' ? 0.5 : 1 }}
                >
                  {isNone ? '🌈' : '🏆'}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                    {r.prizeNameSnapshot}
                    {r.prizeLevelSnapshot ? <span className="muted small" style={{ marginLeft: 8, fontWeight: 500 }}>{r.prizeLevelSnapshot}</span> : null}
                  </div>
                  <div className="small muted">
                    {r.lotteryTitle} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                    {r.status === 'revoked' && r.revokeReason ? ` · 撤回原因：${r.revokeReason}` : ''}
                  </div>
                </div>
                <div className="spacer" />
                <span className={`badge ${st.cls}`}>{st.text}</span>
                <Link className="btn btn-sm btn-ghost" to={`/l/${r.shareCode}`}>查看活动</Link>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
