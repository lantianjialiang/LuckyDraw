import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Wheel from '../components/FortuneSticks.jsx';
import ResultOverlay from '../components/ResultOverlay.jsx';
import WinnersTicker from '../components/WinnersTicker.jsx';
import CheckInCard from '../components/CheckInCard.jsx';
import AvatarWall from '../components/AvatarWall.jsx';
import Avatar from '../components/Avatar.jsx';
import OnsiteLottery from './OnsiteLottery.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { sfx } from '../lib/sound.js';

function useCountdown(endAt) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!endAt) return undefined;
    const tick = () => {
      const diff = new Date(endAt).getTime() - Date.now();
      if (diff <= 0) { setText('已截止'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setText(d > 0 ? `${d} 天 ${h} 小时` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);
  return text;
}

const STATUS_META = {
  active: { cls: 'badge-live', text: '进行中' },
  draft: { cls: 'badge-draft', text: '未开始' },
  ended: { cls: 'badge-ended', text: '已结束' },
};

export default function Lottery() {
  const { shareCode } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [justRevoked, setJustRevoked] = useState(null);
  const wheelRef = useRef(null);
  const idemRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/api/lotteries/share/${shareCode}`);
      setData(d.lottery);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [shareCode]);

  useEffect(() => { load(); }, [load]);

  const lottery = data;
  const prizes = lottery?.prizes || [];
  const me = lottery?.me;
  const countdown = useCountdown(lottery?.endAt);

  const poolTotal = lottery?.poolRemaining ?? 0;

  const canDraw = useMemo(() => {
    if (!lottery) return false;
    if (lottery.status !== 'active') return false;
    if (me?.hasParticipated) return false;
    if (poolTotal <= 0) return false;
    return Boolean(me?.canDraw ?? true);
  }, [lottery, me, poolTotal]);

  const buttonLabel = useMemo(() => {
    if (!lottery) return '加载中';
    if (!user) return '登录参与';
    if (spinning) return '抽奖中';
    if (me?.hasParticipated) return '已参与';
    if (lottery.status === 'ended') return '已结束';
    if (lottery.status === 'draft') return '未开始';
    if (poolTotal <= 0) return '已抽完';
    if (me && me.canDraw === false) return '次数已用完';
    return '开始抽奖';
  }, [lottery, user, spinning, me, poolTotal]);

  const handleSpin = async () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`);
      return;
    }
    if (!canDraw || spinning) return;

    setSpinning(true);
    sfx.whoosh();
    // 每次抽奖一个幂等键：双击 / 多标签页也只会产生一条记录
    const key = globalThis.crypto?.randomUUID?.() || `k_${Date.now()}_${Math.random()}`;
    idemRef.current = key;

    try {
      const res = await api.post(`/api/lotteries/${lottery.id}/draw`, {}, { headers: { 'Idempotency-Key': key } });
      const record = res.record;
      // 服务端已经定好结果，动画只负责把它转到位
      await wheelRef.current?.spinTo(record.prizeId);
      await new Promise((r) => setTimeout(r, 180));
      setResult(record);
      setData((prev) => (prev ? { ...prev, me: { ...prev.me, hasParticipated: true, record, canDraw: false } } : prev));
    } catch (err) {
      toast(err.message, 'error');
      if (err.code === 'CONFLICT') load();
    } finally {
      setSpinning(false);
    }
  };

  const closeResult = async () => {
    setResult(null);
    await load();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('活动链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  if (error) {
    return (
      <main className="container" style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '80px 24px' }}>
        <div className="card card-pad center" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 46, marginBottom: 14 }}>🔍</div>
          <h2 style={{ margin: '0 0 10px' }}>链接无效</h2>
          <p className="muted small" style={{ marginBottom: 20 }}>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>回到活动广场</button>
        </div>
      </main>
    );
  }

  if (!lottery) {
    return (
      <main className="container" style={{ flex: 1, paddingTop: 40 }}>
        <div className="card skeleton" style={{ height: 420 }} />
      </main>
    );
  }

  // 年会现场模式走另一套页面：签到 → 主持人按奖项开奖
  if (lottery.mode === 'onsite') {
    return <OnsiteLottery lottery={lottery} onReload={load} />;
  }

  const statusMeta = STATUS_META[lottery.status] || STATUS_META.draft;
  const myRecord = me?.record;
  const revoked = justRevoked || me?.revoked;
  const icon = myRecord ? prizes.find((p) => p.id === myRecord.prizeId)?.image : null;

  return (
    <main className="container" style={{ flex: 1, paddingTop: 32 }}>
      <header className="rise-in" style={{ marginBottom: 6 }}>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className={`badge ${statusMeta.cls}`}><i className="badge-dot" />{statusMeta.text}</span>
          <span className="badge badge-draft mono">{lottery.shareCode}</span>
          {countdown && lottery.status === 'active' && (
            <span className="small muted">距结束 <b className="mono" style={{ color: 'var(--text)' }}>{countdown}</b></span>
          )}
        </div>
        <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', letterSpacing: '-0.035em', margin: '14px 0 8px', fontWeight: 900 }}>
          {lottery.title}
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.65, maxWidth: 720 }}>
          {lottery.description || '摇一支幸运签，试试今天的手气。'}
        </p>
      </header>

      {revoked && !myRecord && (
        <div className="notice rise-in" style={{ marginTop: 18 }}>
          ⚠️ 你的上一次抽奖结果已被管理员撤回{revoked.reason ? `（${revoked.reason}）` : ''}，现在可以重新抽取。
        </div>
      )}

      <div className="wheel-page">
        <section>
          <Wheel
            ref={wheelRef}
            prizes={prizes}
            onSpin={handleSpin}
            disabled={!canDraw || spinning}
            buttonLabel={buttonLabel}
            buttonSub={canDraw ? `${poolTotal} 份奖品` : undefined}
          />
          <div className="center marquee-hint" style={{ justifyContent: 'center' }}>
            <span>🔒 结果由服务端随机决定</span>
            <span>·</span>
            <span>🎯 每次抽奖独立计算</span>
          </div>
          <WinnersTicker lotteryId={lottery.id} />
        </section>

        <aside className="side-panel">
          {myRecord && (
            <div className="result-banner">
              <div className="small muted" style={{ marginBottom: 6 }}>我的抽奖结果</div>
              <div className="flex" style={{ gap: 12 }}>
                <div className="prize-chip" style={{ width: 42, height: 42, fontSize: 20 }}>
                  {icon || (myRecord.prizeTypeSnapshot === 'none' ? '🌈' : '🏆')}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{myRecord.prizeNameSnapshot}</div>
                  <div className="small muted">
                    {myRecord.prizeLevelSnapshot || '—'} · {new Date(myRecord.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!user && (
            <div className="notice notice-neutral">
              登录后即可参与抽奖，登录状态会带你回到本页面。
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)}
                >
                  去登录
                </button>
              </div>
            </div>
          )}

          <div className="card card-pad">
            <h3 className="card-title">奖品与实时概率</h3>
            <div>
              {prizes.map((p, i) => (
                <div key={p.id} className="prize-row">
                  <div className="prize-chip" style={{ background: `${p.color || '#FF9F1C'}22`, borderColor: `${p.color || '#FF9F1C'}55` }}>
                    {p.image || '🎁'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="prize-name">{p.name}</div>
                    <div className="prize-odds">
                      剩余 <b style={{ color: 'var(--text)' }}>{p.remainingCount}</b> 份
                      {p.type === 'none' ? ' · 未中奖' : ''}
                    </div>
                    <div className="prize-bar">
                      <span style={{ width: `${Math.max(2, p.probability * 100)}%`, background: p.color || '#FF9F1C' }} />
                    </div>
                  </div>
                  <div className="mono small" style={{ color: 'var(--gold)', fontWeight: 700, minWidth: 46, textAlign: 'right' }}>
                    {(p.probability * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
              {prizes.length === 0 && <div className="empty" style={{ padding: '26px 0' }}>奖池已空</div>}
            </div>
            <div className="hint" style={{ marginTop: 14, lineHeight: 1.6 }}>
              概率 = 该奖品剩余数量 ÷ 奖池剩余总量，随发放实时变化。
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="card-title">活动信息</h3>
            <div className="stack small">
              <div className="flex"><span className="muted">奖品剩余</span><div className="spacer" /><b className="mono">{poolTotal} 份</b></div>
              <div className="flex"><span className="muted">每人限抽</span><div className="spacer" /><b>{lottery.maxDrawsPerUser} 次</b></div>
              {lottery.startAt && (
                <div className="flex"><span className="muted">开始时间</span><div className="spacer" /><span className="mono">{new Date(lottery.startAt).toLocaleDateString('zh-CN')}</span></div>
              )}
              {lottery.endAt && (
                <div className="flex"><span className="muted">结束时间</span><div className="spacer" /><span className="mono">{new Date(lottery.endAt).toLocaleDateString('zh-CN')}</span></div>
              )}
            </div>
            <button className="btn btn-block btn-sm" style={{ marginTop: 16 }} onClick={copyLink}>
              🔗 复制活动链接
            </button>
          </div>
        </aside>
      </div>

      <ResultOverlay result={result} icon={icon} onClose={closeResult} />
    </main>
  );
}

