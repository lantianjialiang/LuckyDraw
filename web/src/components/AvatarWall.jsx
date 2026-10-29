import React, { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import { api } from '../api/client.js';

/** 签到墙：头像网格 + 祝福语轮播 */
export default function AvatarWall({ lotteryId, refreshKey = 0, limit = 60 }) {
  const [data, setData] = useState({ total: 0, items: [] });
  const [blessIdx, setBlessIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    api.enrollments(lotteryId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [lotteryId, refreshKey]);

  const withBlessing = data.items.filter((i) => i.blessing);
  useEffect(() => {
    if (withBlessing.length <= 1) return undefined;
    const id = setInterval(() => setBlessIdx((i) => (i + 1) % withBlessing.length), 3200);
    return () => clearInterval(id);
  }, [withBlessing.length]);

  if (!data.total) {
    return (
      <div className="card card-pad center">
        <div style={{ fontSize: 34, marginBottom: 8 }}>🪑</div>
        <div className="muted small">还没有人签到，第一个签到的就是你</div>
      </div>
    );
  }

  const shown = data.items.slice(0, limit);
  const current = withBlessing[blessIdx % Math.max(1, withBlessing.length)];

  return (
    <div className="card card-pad">
      <div className="flex" style={{ marginBottom: 14 }}>
        <h3 className="card-title" style={{ margin: 0 }}>已签到 {data.total} 人</h3>
        <div className="spacer" />
        {data.total > shown.length && <span className="small muted">展示最近 {shown.length} 位</span>}
      </div>

      <div className="avatar-wall">
        {shown.map((p) => (
          <div key={p.employeeNo} className="wall-cell" title={`${p.displayName}${p.department ? ` · ${p.department}` : ''}`}>
            <Avatar avatar={p.avatar} avatarKind={p.avatarKind} name={p.displayName} size={44} />
            <div className="wall-name">{p.displayName}</div>
          </div>
        ))}
      </div>

      {current && (
        <div className="blessing-strip">
          <Avatar avatar={current.avatar} avatarKind={current.avatarKind} name={current.displayName} size={30} />
          <div style={{ minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 700 }}>{current.displayName}</div>
            <div className="wall-bless">“{current.blessing}”</div>
          </div>
        </div>
      )}
    </div>
  );
}
