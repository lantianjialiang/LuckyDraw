import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 最近中奖播报 —— 让页面有"现场"感 */
export default function WinnersTicker({ lotteryId }) {
  const [list, setList] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get(`/api/lotteries/${lotteryId}/winners`)
        .then((d) => { if (alive) setList(d.winners || []); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [lotteryId]);

  const marquee = list.length > 3;
  const items = useMemo(() => (marquee ? [...list, ...list] : list), [list, marquee]);

  if (!list.length) return null;

  return (
    <div className="winners">
      <div className="winners-head">
        <i className="live-dot" />
        最近中奖
      </div>
      <div className="winners-viewport">
        <div className={`winners-track ${marquee ? 'is-marquee' : ''}`} style={marquee ? { animationDuration: `${Math.max(16, list.length * 4)}s` } : undefined}>
          {items.map((w, i) => (
            <div className="winner-pill" key={`${w.user}-${w.at}-${i}`}>
              <span className="winner-avatar">{w.user.slice(0, 1)}</span>
              <span className="winner-text">
                <b>{w.user}</b> 抽中 {w.prize}
              </span>
              <span className="winner-time">{relTime(w.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
