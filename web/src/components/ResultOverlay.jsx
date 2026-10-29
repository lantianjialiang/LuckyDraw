import React, { useEffect, useState } from 'react';
import Confetti from './Confetti.jsx';
import { sfx } from '../lib/sound.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function ResultOverlay({ result, icon, onClose }) {
  const [burst, setBurst] = useState(false);
  const { user } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!result) return;
    setBurst(true);
    if (result.isWin) sfx.win(); else sfx.lose();
    const t = setTimeout(() => setBurst(false), 5200);
    return () => clearTimeout(t);
  }, [result]);

  if (!result) return null;
  const win = result.isWin;

  return (
    <>
      <Confetti active={burst} tone={win ? 'win' : 'lose'} />
      <div className="overlay" onClick={onClose}>
        {win && <div className="shockwave" style={{ top: '42%', left: '50%', marginLeft: -100, marginTop: -100 }} />}
        <div className={`result-card ${win ? '' : 'lose'}`} onClick={(e) => e.stopPropagation()}>
          <div className="result-eyebrow">{win ? 'CONGRATULATIONS' : 'THANKS FOR PLAYING'}</div>
          <div className="result-icon">{icon || (win ? '🏆' : '🌈')}</div>
          <h2 className="result-name">{result.prizeName}</h2>
          <div className="result-level">
            {win ? `${result.prizeLevel || '恭喜中奖'} · 请留意领取通知` : '没关系，好运正在赶来的路上'}
          </div>
          <div className="result-actions">
            {win && (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => { toast('已记录，请按活动说明领取奖品 🎁', 'success'); onClose(); }}
              >
                收下这份好运
              </button>
            )}
            {!win && (
              <button className="btn btn-lg" onClick={onClose}>知道了</button>
            )}
            {user && (
              <button className="btn btn-ghost" onClick={() => { window.location.href = '/me/records'; }}>
                查看我的记录
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
