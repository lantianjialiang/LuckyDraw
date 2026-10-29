import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Avatar from '../components/Avatar.jsx';
import AvatarWall from '../components/AvatarWall.jsx';
import CheckInCard from '../components/CheckInCard.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

/**
 * 年会现场模式（用户端）：
 * 分享链接进来 → 工号+姓名签到（带头像、祝福语）→ 等主持人按奖项逐个抽取。
 */
export default function OnsiteLottery({ lottery, onReload }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [enrollment, setEnrollment] = useState(null);
  const [myRecord, setMyRecord] = useState(null);
  const [checked, setChecked] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [wallKey, setWallKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!lottery?.id) return;
    // 没登录也要显示签到表单，否则页面会一直空着
    if (!user) {
      setEnrollment(null);
      setMyRecord(null);
      setChecked(true);
      return;
    }
    try {
      const [e, r] = await Promise.all([
        api.myEnrollment(lottery.id),
        api.get(`/api/lotteries/${lottery.id}/my-result`),
      ]);
      setEnrollment(e.enrollment);
      setMyRecord(r.record && r.record.status !== 'revoked' ? r.record : null);
    } catch {
      setEnrollment(null);
      setMyRecord(null);
    } finally {
      setChecked(true);
    }
  }, [user, lottery?.id]);

  useEffect(() => { setChecked(false); refresh(); }, [refresh]);

  const signedIn = Boolean(enrollment);
  const isWinner = Boolean(myRecord && myRecord.prizeTypeSnapshot !== 'none');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast('活动链接已复制', 'success');
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  const switchAccount = () => {
    logout();
    setEnrollment(null);
  };

  return (
    <main className="container" style={{ flex: 1, paddingTop: 32 }}>
      <header className="rise-in" style={{ marginBottom: 22 }}>
        <div className="flex" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="badge badge-live"><i className="badge-dot" />现场抽奖</span>
          <span className="badge badge-draft mono">{lottery.shareCode}</span>
          <span className="small muted">已签到 <b style={{ color: 'var(--text)' }}>{lottery.checkinCount ?? 0}</b> 人</span>
        </div>
        <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', letterSpacing: '-0.035em', margin: '14px 0 8px', fontWeight: 900 }}>
          {lottery.title}
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.65, maxWidth: 720 }}>
          {lottery.description || '签到后等待主持人开奖。'}
        </p>
      </header>

      <div className="onsite-page">
        <section className="stack" style={{ gap: 16 }}>
          {!user && (
            <div className="notice notice-neutral">
              已有账号？登录后即可查看自己的中奖情况。
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`)}
                >
                  去登录
                </button>
              </div>
            </div>
          )}

          {checked && !signedIn && (
            <CheckInCard
              lottery={lottery}
              onDone={() => { setWallKey((k) => k + 1); refresh(); onReload?.(); }}
            />
          )}

          {signedIn && (
            <div className="card card-pad my-checkin">
              <div className="flex" style={{ gap: 14, alignItems: 'flex-start' }}>
                <Avatar
                  avatar={enrollment.avatar} avatarKind={enrollment.avatarKind}
                  name={enrollment.displayName} size={64} ring
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{enrollment.displayName}</div>
                  <div className="small muted">
                    工号 {enrollment.employeeNo}
                    {enrollment.department ? ` · ${enrollment.department}` : ''}
                  </div>
                  {enrollment.blessing && (
                    <div className="my-blessing">“{enrollment.blessing}”</div>
                  )}
                </div>
                <button className="btn btn-sm btn-ghost" onClick={switchAccount} title="换个工号签到">切换</button>
              </div>

              <div className="status-line">
                {isWinner ? (
                  <>
                    <span className="badge badge-won"><i className="badge-dot" />中奖啦</span>
                    <b style={{ marginLeft: 8 }}>{myRecord.prizeNameSnapshot}</b>
                    <span className="small muted">{myRecord.prizeLevelSnapshot}</span>
                  </>
                ) : myRecord ? (
                  <span className="small muted">本轮未中奖，还有机会 🌈</span>
                ) : (
                  <span className="small muted">已签到，等待开奖…</span>
                )}
              </div>

              <button
                className="btn btn-sm btn-ghost"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setShowEdit((v) => !v)}
              >
                修改资料
              </button>
              {showEdit && (
                <div style={{ width: '100%' }}>
                  <CheckInCard
                    lottery={lottery}
                    initial={enrollment}
                    onDone={() => { setShowEdit(false); setWallKey((k) => k + 1); refresh(); }}
                  />
                </div>
              )}
            </div>
          )}

          <AvatarWall lotteryId={lottery.id} refreshKey={wallKey} />
        </section>

        <aside className="side-panel">
          <div className="card card-pad">
            <h3 className="card-title">奖项设置</h3>
            <div>
              {(lottery.allPrizes || lottery.prizes).map((p) => (
                <div key={p.id} className="prize-row">
                  <div
                    className="prize-chip"
                    style={{ background: `${p.color || '#FF9F1C'}22`, borderColor: `${p.color || '#FF9F1C'}55` }}
                  >
                    {p.image || '🎁'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="prize-name">{p.name}</div>
                    <div className="prize-odds">
                      {p.level || '奖品'} · 共 <b style={{ color: 'var(--text)' }}>{p.totalCount ?? p.remainingCount}</b> 份
                      {p.remainingCount > 0
                        ? <> · 剩 <b style={{ color: 'var(--text)' }}>{p.remainingCount}</b> 份</>
                        : <span className="badge badge-draft" style={{ marginLeft: 6 }}>已抽完</span>}
                    </div>
                  </div>
                </div>
              ))}
              {lottery.prizes.length === 0 && <div className="empty" style={{ padding: '26px 0' }}>还没有设置奖项</div>}
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="card-title">活动信息</h3>
            <div className="stack small">
              <div className="flex"><span className="muted">抽奖方式</span><div className="spacer" /><b>主持人现场逐个开奖</b></div>
              {lottery.startAt && (
                <div className="flex"><span className="muted">开始</span><div className="spacer" /><span className="mono">{new Date(lottery.startAt).toLocaleString('zh-CN', { hour12: false })}</span></div>
              )}
              {lottery.endAt && (
                <div className="flex"><span className="muted">结束</span><div className="spacer" /><span className="mono">{new Date(lottery.endAt).toLocaleString('zh-CN', { hour12: false })}</span></div>
              )}
            </div>
            <button className="btn btn-block btn-sm" style={{ marginTop: 16 }} onClick={copyLink}>🔗 复制活动链接</button>
          </div>
        </aside>
      </div>
    </main>
  );
}
