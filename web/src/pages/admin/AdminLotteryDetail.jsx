import { userLabel, employeeNumber } from '../../lib/userLabel.js';
import PrizePhoto from '../../components/PrizePhoto.jsx';
import StageBrandSettings from './StageBrandSettings.jsx';
import AdminEmployees from './AdminEmployees.jsx';
import PrizeIconSelect from '../../components/PrizeIconSelect.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../../api/client.js';
import { useToast } from '../../lib/toast.jsx';
import Avatar from '../../components/Avatar.jsx';

const STATUS = {
  draft: { cls: 'badge-draft', text: '草稿' },
  active: { cls: 'badge-live', text: '进行中' },
  ended: { cls: 'badge-ended', text: '已结束' },
};
const REC_STATUS = {
  won: { cls: 'badge-won', text: '待领取' },
  claimed: { cls: 'badge-claimed', text: '已领取' },
  revoked: { cls: 'badge-revoked', text: '已撤回' },
};

const emptyPrize = { photo: '', name: '', level: '', type: 'prize', totalCount: 1, image: '🎁', color: '#FF9F1C' };

/** ISO ↔ datetime-local 输入框（按本地时区显示，避免差 8 小时） */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toISO = (v) => (v ? new Date(v).toISOString() : null);

export default function AdminLotteryDetail() {
  const { id } = useParams();
  const toast = useToast();

  const [lottery, setLottery] = useState(null);
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('prizes');
  const [recordState, setRecordState] = useState({ records: [], total: 0, page: 1, pageSize: 20, status: '', keyword: '' });
  const [logs, setLogs] = useState([]);
  const [prizeForm, setPrizeForm] = useState(emptyPrize);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');
  const [settings, setSettings] = useState(null);
  const [checkins, setCheckins] = useState({ items: [], total: 0, eligible: 0 });

  useEffect(() => {
    if (!lottery) return;
    setSettings({
      title: lottery.title,
      description: lottery.description || '',
      startAt: toLocalInput(lottery.startAt),
      endAt: toLocalInput(lottery.endAt),
      maxDrawsPerUser: lottery.maxDrawsPerUser ?? 1,
      mode: lottery.mode || 'online',
      checkinHint: lottery.checkinHint || '',
    });
  }, [lottery?.id]);

  useEffect(() => {
    if (tab !== 'checkin') return;
    api.adminEnrollments(id).then(setCheckins).catch((e) => toast(e.message, 'error'));
  }, [tab, id, toast]);

  const saveSettings = async () => {
    if (!settings?.title?.trim()) { toast('标题不能为空', 'error'); return; }
    if (settings.startAt && settings.endAt && new Date(settings.endAt) <= new Date(settings.startAt)) {
      toast('结束时间必须晚于开始时间', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/admin/lotteries/${id}`, {
        title: settings.title.trim(),
        description: settings.description,
        startAt: toISO(settings.startAt),
        endAt: toISO(settings.endAt),
        maxDrawsPerUser: Number(settings.maxDrawsPerUser) || 1,
        mode: settings.mode,
        checkinHint: settings.checkinHint,
      });
      toast('活动设置已保存', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const shareUrl = useMemo(() => {
    if (!lottery?.shareCode) return '';
    return `${window.location.origin}/l/${lottery.shareCode}`;
  }, [lottery?.shareCode]);

  const loadAll = useCallback(async () => {
    try {
      const d = await api.get(`/api/admin/lotteries/${id}`);
      setLottery(d.lottery);
      setStats(d.stats);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [id, toast]);

  const loadRecords = useCallback(async (patch = {}) => {
    const next = { ...recordState, ...patch };
    setRecordState(next);
    try {
      const qs = new URLSearchParams({
        page: String(next.page), pageSize: String(next.pageSize),
        ...(next.status ? { status: next.status } : {}),
        ...(next.keyword ? { keyword: next.keyword } : {}),
      });
      const d = await api.get(`/api/admin/lotteries/${id}/records?${qs}`);
      setRecordState((s) => ({ ...s, records: d.records, total: d.total }));
      if (d.stats) setStats(d.stats);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [id, recordState, toast]);

  const loadLogs = useCallback(async () => {
    try {
      const d = await api.get(`/api/admin/logs?lotteryId=${id}`);
      setLogs(d.logs || []);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [id, toast]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (tab === 'records') loadRecords({ page: 1 });
    if (tab === 'logs') loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!shareUrl) return;
    QRCode.toDataURL(shareUrl, { margin: 1, width: 320, color: { dark: '#08080d', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [shareUrl]);

  /* ------------------------- actions ------------------------- */

  const action = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      if (successMsg) toast(successMsg, 'success');
      await loadAll();
      if (tab === 'records') loadRecords({});
      if (tab === 'logs') loadLogs();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const publish = () => action(() => api.post(`/api/admin/lotteries/${id}/publish`), '活动已发布，分享链接已生成');
  const end = () => action(() => api.post(`/api/admin/lotteries/${id}/end`), '活动已结束');
  const reopen = () => action(() => api.post(`/api/admin/lotteries/${id}/reopen`), '活动已重新开启');

  const addPrize = async () => {
    if (!prizeForm.name.trim()) { toast('请填写奖品名称', 'error'); return; }
    setAdding(true);
    try {
      const d = await api.post(`/api/admin/lotteries/${id}/prizes`, {
        ...prizeForm,
        name: prizeForm.name.trim(),
        totalCount: Number(prizeForm.totalCount) || 0,
      });
      setStats(d.stats);
      setPrizeForm(emptyPrize);
      toast('奖品已加入奖池', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const patchPrize = async (prize, patch, successMsg) => {
    try {
      const d = await api.patch(`/api/admin/prizes/${prize.id}`, { ...patch, version: prize.version });
      setStats(d.stats);
      if (successMsg) toast(successMsg, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changeQty = (prize, delta) => {
    const nextTotal = prize.totalCount + delta;
    if (nextTotal < 0) return;
    patchPrize(prize, { totalCount: nextTotal });
  };

  const removePrize = async (prize) => {
    try {
      const d = await api.del(`/api/admin/prizes/${prize.id}`);
      setStats(d.stats);
      toast(d.deleted ? '奖品已删除' : d.message, d.deleted ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setConfirm(null);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.post(`/api/admin/records/${revoking.id}/revoke`, { reason: revoking.reason || '' });
      toast('已撤回，库存已退回，该用户可重新抽奖', 'success');
      setRevoking(null);
      await loadAll();
      loadRecords({});
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const claim = async (record) => {
    try {
      await api.post(`/api/admin/records/${record.id}/claim`);
      toast('已标记为已领取', 'success');
      loadRecords({});
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const exportCsv = () => {
    const rows = [['抽奖时间', '姓名', '工号', '奖品', '等级', '状态', '撤回原因']];
    recordState.records.forEach((r) => rows.push([
      new Date(r.createdAt).toLocaleString('zh-CN'),
      userLabel(r),
      employeeNumber(r),
      r.prizeNameSnapshot,
      r.prizeLevelSnapshot,
      REC_STATUS[r.status]?.text || r.status,
      r.revokeReason || '',
    ]));
    const csv = `\uFEFF${rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lottery.title}-中奖名单-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出当前页数据', 'success');
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制', 'success'); } catch { toast('复制失败', 'error'); }
  };

  if (!lottery || !stats) return <div className="card skeleton" style={{ height: 300 }} />;

  const st = STATUS[lottery.status] || STATUS.draft;
  const locked = lottery.status === 'ended';
  const poolTotal = stats.poolRemaining;

  return (
    <>
      <div className="admin-head">
        <div style={{ minWidth: 0 }}>
          <div className="flex" style={{ gap: 8, marginBottom: 8 }}>
            <Link to="/admin" className="small muted">← 活动列表</Link>
            <span className={`badge ${st.cls}`}><i className="badge-dot" />{st.text}</span>
            {lottery.shareCode && <span className="small mono muted">/{lottery.shareCode}</span>}
          </div>
          <h1>{lottery.title}</h1>
          <p>{lottery.description || '暂无描述'}</p>
        </div>
        <div className="spacer" />
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>

          {lottery.status === 'draft' && (
            <button className="btn btn-primary" disabled={busy}
              onClick={() => setConfirm({ title: '发布活动？', desc: `发布后将生成分享链接，用户可立即参与。当前奖池 ${poolTotal} 份。`, ok: '确认发布', fn: publish })}>
              🚀 发布活动
            </button>
          )}
          {lottery.status === 'active' && (
            <>
              <Link className="btn btn-sm" to={`/l/${lottery.shareCode}`} target="_blank">预览前台</Link>
              {lottery.mode === 'onsite' && (
                <Link className="btn btn-sm btn-primary" to={`/admin/lotteries/${lottery.id}/stage`}>
                  🎤 进入抽奖台
                </Link>
              )}
              <button className="btn btn-sm btn-danger" disabled={busy}
                onClick={() => setConfirm({ title: '结束活动？', desc: '结束后奖品与记录将锁定为只读，用户无法继续抽奖。', ok: '确认结束', fn: end, danger: true })}>
                结束活动
              </button>
            </>
          )}
          {lottery.status === 'ended' && (
            <button className="btn btn-sm" disabled={busy}
              onClick={() => setConfirm({ title: '重新开启活动？', desc: '活动将回到「进行中」，用户可以继续抽奖，也可继续撤回记录。', ok: '重新开启', fn: reopen })}>
              ♻️ 重新开启
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-label">奖池剩余</div>
          <div className="stat-value" style={{ color: 'var(--gold)' }}>{poolTotal}<small>份</small></div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">已中奖</div>
          <div className="stat-value">{stats.records.won + stats.records.claimed}<small>人</small></div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">已领取</div>
          <div className="stat-value">{stats.records.claimed}<small>人</small></div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">已撤回</div>
          <div className="stat-value" style={{ color: 'var(--rose)' }}>{stats.records.revoked}<small>条</small></div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">奖品数</div>
          <div className="stat-value">{stats.prizes.filter((p) => p.status === 'active').length}<small>个</small></div>
        </div>
      </div>

      {lottery.shareCode && (
        <div className="card card-pad" style={{ marginBottom: 20, display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
          {qr && <div className="qr-box"><img src={qr} alt="活动二维码" width={104} height={104} /></div>}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="small muted" style={{ marginBottom: 8, fontWeight: 700, letterSpacing: '0.06em' }}>分享面板</div>
            <div className="share-link">
              <span>{shareUrl}</span>
              <button className="btn btn-sm btn-primary" onClick={() => copy(shareUrl)}>复制</button>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>扫码或复制链接即可参与，微信内可自动识别。</div>
          </div>
        </div>
      )}

      <div className="tabs"><button className={`tab ${tab === 'brand' ? 'active' : ''}`} onClick={() => setTab('brand')}>品牌与背景</button>
        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>活动设置</button>
        <button className={`tab ${tab === 'prizes' ? 'active' : ''}`} onClick={() => setTab('prizes')}>奖品管理</button>
        {lottery.mode === 'onsite' && (
          <button className={`tab ${tab === 'checkin' ? 'active' : ''}`} onClick={() => setTab('checkin')}>
            签到名单 {checkins.total ? `(${checkins.total})` : ''}
          </button>
        )}
        <button className={`tab ${tab === 'employees' ? 'active' : ''}`} onClick={() => setTab('employees')}>员工名册</button>
        <button className={`tab ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}>中奖名单</button>
        <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>操作日志</button>
      </div>

      {tab === 'brand' && <StageBrandSettings id={id} />}
      {tab === 'employees' && <AdminEmployees embedded key={id} />}

      {tab === 'settings' && settings && (
        <div className="card card-pad" style={{ maxWidth: 720 }}>
          <h3 className="card-title">基本设置</h3>
          <div className="field">
            <label>活动标题</label>
            <input className="input" value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })} />
          </div>
          <div className="field">
            <label>活动说明</label>
            <textarea className="textarea" value={settings.description}
              onChange={(e) => setSettings({ ...settings, description: e.target.value })}
              placeholder="中奖后如何领取、注意事项等" />
          </div>

          <h3 className="card-title" style={{ marginTop: 22 }}>时间范围</h3>
          <div className="row">
            <div className="field">
              <label>开始时间</label>
              <input className="input" type="datetime-local" value={settings.startAt}
                onChange={(e) => setSettings({ ...settings, startAt: e.target.value })} />
              <span className="hint">留空表示立即开始</span>
            </div>
            <div className="field">
              <label>结束时间</label>
              <input className="input" type="datetime-local" value={settings.endAt}
                onChange={(e) => setSettings({ ...settings, endAt: e.target.value })} />
              <span className="hint">留空表示不限制</span>
            </div>
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            <button className="btn btn-sm" onClick={() => setSettings({ ...settings, startAt: toLocalInput(new Date().toISOString()) })}>
              开始时间设为现在
            </button>
            <button className="btn btn-sm" onClick={() => setSettings({
              ...settings,
              startAt: toLocalInput(new Date().toISOString()),
              endAt: toLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString()),
            })}>设为接下来 7 天</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSettings({ ...settings, startAt: '', endAt: '' })}>
              清除时间限制
            </button>
          </div>

          <h3 className="card-title" style={{ marginTop: 4 }}>抽奖方式</h3>
          <div className="field">
            <label>模式</label>
            <select className="select" value={settings.mode}
              onChange={(e) => setSettings({ ...settings, mode: e.target.value })}>
              <option value="online">自助抽奖 — 用户打开链接自己转盘</option>
              <option value="onsite">年会现场 — 先签到，主持人按奖项逐个开奖</option>
            </select>
            <span className="hint">
              {settings.mode === 'onsite'
                ? '现场模式：参与者用工号+姓名签到并留下头像和祝福语，你在「抽奖台」按奖项抽取，可随时回退。'
                : '自助模式：用户打开分享链接即可转盘抽奖，每人限一次。'}
            </span>
          </div>
          {settings.mode === 'onsite' && (
            <div className="field">
              <label>签到提示语</label>
              <input className="input" value={settings.checkinHint} maxLength={120}
                placeholder="例如：请用工号+姓名签到，并留下你的新年祝福"
                onChange={(e) => setSettings({ ...settings, checkinHint: e.target.value })} />
            </div>
          )}
          <div className="field" style={{ maxWidth: 220 }}>
            <label>每人可中次数</label>
            <input className="input" type="number" min="1" max="100" value={settings.maxDrawsPerUser}
              onChange={(e) => setSettings({ ...settings, maxDrawsPerUser: e.target.value })} />
          </div>

          <div className="flex" style={{ gap: 10, marginTop: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={saveSettings}>
              {busy ? '保存中…' : '保存设置'}
            </button>
            <button className="btn btn-ghost" onClick={() => setSettings({
              title: lottery.title, description: lottery.description || '',
              startAt: toLocalInput(lottery.startAt), endAt: toLocalInput(lottery.endAt),
              maxDrawsPerUser: lottery.maxDrawsPerUser ?? 1,
              mode: lottery.mode || 'online', checkinHint: lottery.checkinHint || '',
            })}>还原</button>
          </div>
        </div>
      )}

      {tab === 'checkin' && (
        <div className="card card-pad">
          <div className="flex" style={{ marginBottom: 14 }}>
            <h3 className="card-title" style={{ margin: 0 }}>签到名单</h3>
            <div className="spacer" />
            <span className="small muted">共 {checkins.total} 人 · 未中奖可抽 {checkins.eligible} 人</span>
            {lottery.status === 'active' && (
              <Link className="btn btn-sm btn-primary" to={`/admin/lotteries/${id}/stage`}>🎤 去抽奖台</Link>
            )}
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>头像</th><th>工号</th><th>姓名</th><th>部门</th><th>祝福语</th><th>状态</th></tr>
              </thead>
              <tbody>
                {checkins.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Avatar avatar={e.avatar} avatarKind={e.avatarKind} name={e.displayName} size={34} />
                    </td>
                    <td className="mono">{e.employeeNo}</td>
                    <td style={{ fontWeight: 700 }}>{e.displayName}</td>
                    <td className="muted small">{e.department || '—'}</td>
                    <td className="small" style={{ maxWidth: 240 }}>{e.blessing || '—'}</td>
                    <td>
                      {e.prizeNameSnapshot
                        ? <span className="badge badge-won">{e.prizeNameSnapshot}</span>
                        : <span className="small muted">未中奖</span>}
                    </td>
                  </tr>
                ))}
                {checkins.items.length === 0 && (
                  <tr><td colSpan={6}><div className="empty">还没有人签到</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'prizes' && (
        <>
          {!locked && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="small muted" style={{ marginBottom: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
                添加奖项（可随时增删，概率实时重算）
              </div>
              <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: '2 1 160px' }} placeholder="奖品名称，如 iPhone 16 Pro"
                  value={prizeForm.name} onChange={(e) => setPrizeForm({ ...prizeForm, name: e.target.value })} />
                <input className="input" style={{ flex: '1 1 110px' }} placeholder="等级，如 一等奖"
                  value={prizeForm.level} onChange={(e) => setPrizeForm({ ...prizeForm, level: e.target.value })} />
                <input className="input" style={{ flex: '0 1 90px' }} type="number" min="0" placeholder="数量"
                  value={prizeForm.totalCount} onChange={(e) => setPrizeForm({ ...prizeForm, totalCount: e.target.value })} />
                <PrizePhoto value={prizeForm.photo} onChange={photo => setPrizeForm({...prizeForm,photo})} /><PrizeIconSelect value={prizeForm.image} onChange={(image) => setPrizeForm({ ...prizeForm, image })} />
                <input className="input" style={{ flex: '0 1 62px', padding: 4, height: 42 }} type="color"
                  value={prizeForm.color} onChange={(e) => setPrizeForm({ ...prizeForm, color: e.target.value })} />
                <select className="select" style={{ flex: '0 1 120px' }} value={prizeForm.type}
                  onChange={(e) => setPrizeForm({ ...prizeForm, type: e.target.value })}>
                  <option value="prize">真实奖品</option>
                  <option value="none">谢谢参与</option>
                </select>
                <button className="btn btn-primary" disabled={adding} onClick={addPrize}>
                  {adding ? '添加中…' : '+ 添加'}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 10 }}>
                提示：「谢谢参与」作为一种特殊奖品参与奖池，也占用数量。奖池总量 ≈ 预期参与人数。
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>奖品</th>
                  <th>等级</th>
                  <th className="num">总数</th>
                  <th className="num">已发</th>
                  <th className="num">剩余</th>
                  <th className="num">当前概率</th>
                  <th>状态</th>
                  <th style={{ width: 210 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {stats.prizes.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex" style={{ gap: 9 }}>
                        <span className="prize-chip" style={{ width: 30, height: 30, fontSize: 14, background: `${p.color || '#FF9F1C'}22` }}>{p.image || '🎁'}</span>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        {p.type === 'none' && <span className="badge badge-draft">未中奖</span>}
                      </div>
                    </td>
                    <td className="muted">{p.level || '—'}</td>
                    <td className="num">{p.totalCount}</td>
                    <td className="num">{p.issuedCount}</td>
                    <td className="num" style={{ color: p.remainingCount === 0 ? 'var(--muted-2)' : 'var(--gold)', fontWeight: 700 }}>{p.remainingCount}</td>
                    <td className="num">
                      <div className="prob-cell">
                        <div className="prob-track"><span style={{ width: `${Math.min(100, p.probability * 100)}%` }} /></div>
                        <span className="mono" style={{ minWidth: 44, textAlign: 'right' }}>{(p.probability * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${p.status === 'active' ? 'badge-live' : 'badge-draft'}`}>
                        {p.status === 'active' ? '在池' : '已下架'}
                      </span>
                    </td>
                    <td>
                      {!locked ? (
                        <div className="flex" style={{ gap: 5 }}>
                          <div className="stepper">
                            <button onClick={() => changeQty(p, -1)} disabled={p.totalCount <= 0} title="总数 -1">−</button>
                            <button onClick={() => changeQty(p, 1)} title="总数 +1">+</button>
                          </div>
                          <button className="btn btn-sm" onClick={() => setEditing(p)}>编辑</button>
                          <button className="btn btn-sm" onClick={() => patchPrize(p, { status: p.status === 'active' ? 'disabled' : 'active' })}>
                            {p.status === 'active' ? '下架' : '上架'}
                          </button>
                          <button className="btn btn-sm btn-danger" title="删除奖品"
                            onClick={() => setConfirm({
                              title: `删除「${p.name}」？`,
                              desc: p.issuedCount > 0
                                ? `该奖品已发出 ${p.issuedCount} 份，为保留历史记录将改为「下架」，停止出奖。`
                                : '该奖品尚无中奖记录，将被彻底删除。',
                              ok: p.issuedCount > 0 ? '确认下架' : '确认删除',
                              danger: true,
                              fn: () => removePrize(p),
                            })}>删</button>
                        </div>
                      ) : <span className="small muted">只读</span>}
                    </td>
                  </tr>
                ))}
                {stats.prizes.length === 0 && (
                  <tr><td colSpan={8}><div className="empty">还没有奖品，先添加一个吧</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'records' && (
        <>
          <div className="flex" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input
              className="input" style={{ maxWidth: 220 }} placeholder="搜索用户或奖品…"
              value={recordState.keyword}
              onChange={(e) => setRecordState((s) => ({ ...s, keyword: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') loadRecords({ page: 1, keyword: e.target.value }); }}
            />
            <select className="select" style={{ maxWidth: 150 }} value={recordState.status}
              onChange={(e) => loadRecords({ page: 1, status: e.target.value })}>
              <option value="">全部状态</option>
              <option value="won">待领取</option>
              <option value="claimed">已领取</option>
              <option value="revoked">已撤回</option>
            </select>
            <button className="btn btn-sm" onClick={() => loadRecords({ page: 1 })}>刷新</button>
            <div className="spacer" />
            <button className="btn btn-sm" onClick={exportCsv}>⤓ 导出 CSV</button>
          </div>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>抽奖时间</th>
                  <th>姓名</th><th>工号</th>
                  <th>奖品快照</th>
                  <th>状态</th>
                  <th style={{ width: 200 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {recordState.records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono small muted">{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
                    <td style={{ fontWeight: 600 }}>{userLabel(r)}</td><td className="mono">{employeeNumber(r)}</td>
                    <td>
                      {r.prizeNameSnapshot}
                      {r.prizeLevelSnapshot ? <span className="muted small" style={{ marginLeft: 6 }}>{r.prizeLevelSnapshot}</span> : null}
                      {r.status === 'revoked' && r.revokeReason && (
                        <div className="small" style={{ color: '#ff8fa8', marginTop: 3 }}>原因：{r.revokeReason}</div>
                      )}
                    </td>
                    <td>
                      {r.prizeTypeSnapshot === 'none' && r.status === 'won'
                        ? <span className="badge badge-draft">未中奖</span>
                        : <span className={`badge ${REC_STATUS[r.status]?.cls}`}>{REC_STATUS[r.status]?.text || r.status}</span>}
                    </td>
                    <td>
                      <div className="flex" style={{ gap: 6 }}>
                        {r.status === 'won' && r.prizeTypeSnapshot !== 'none' && (
                          <button className="btn btn-sm" onClick={() => claim(r)}>标记领取</button>
                        )}
                        {r.status === 'won' && (
                          <button className="btn btn-sm btn-danger"
                            onClick={() => setRevoking({ ...r, reason: '' })}>撤回</button>
                        )}
                        {r.status === 'claimed' && (
                          <button className="btn btn-sm btn-danger"
                            onClick={() => setRevoking({ ...r, reason: '' })}>撤回</button>
                        )}
                        {r.status === 'revoked' && <span className="small muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
                {recordState.records.length === 0 && (
                  <tr><td colSpan={5}><div className="empty">暂无记录</div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex" style={{ marginTop: 14 }}>
            <span className="small muted">共 {recordState.total} 条</span>
            <div className="spacer" />
            <button className="btn btn-sm" disabled={recordState.page <= 1}
              onClick={() => loadRecords({ page: recordState.page - 1 })}>上一页</button>
            <span className="small muted mono" style={{ margin: '0 10px' }}>{recordState.page}</span>
            <button className="btn btn-sm" disabled={recordState.page * recordState.pageSize >= recordState.total}
              onClick={() => loadRecords({ page: recordState.page + 1 })}>下一页</button>
          </div>
        </>
      )}

      {tab === 'logs' && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>变更</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono small muted">{new Date(l.createdAt).toLocaleString('zh-CN')}</td>
                  <td>{l.adminName || '—'}</td>
                  <td><span className="badge badge-draft">{l.action}</span></td>
                  <td className="mono small muted">{l.targetType} · {String(l.targetId || '').slice(0, 14)}</td>
                  <td className="small" style={{ maxWidth: 320 }}>
                    <div style={{ color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.before || '—'}
                    </div>
                    <div style={{ color: 'var(--teal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.after || '—'}
                    </div>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={5}><div className="empty">暂无操作记录</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* 编辑奖品 */}
      {editing && (
        <div className="modal-mask" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑奖品</h3><PrizePhoto value={editing.photo} onChange={photo => setEditing({...editing,photo})} />
            <p>修改名称与等级不影响历史记录（记录保存的是快照）。</p>
            <div className="field">
              <label>名称</label>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="row">
              <div className="field">
                <label>等级</label>
                <input className="input" value={editing.level || ''} onChange={(e) => setEditing({ ...editing, level: e.target.value })} />
              </div>
              <div className="field">
                <label>总数（已发 {editing.issuedCount} 份）</label>
                <input className="input" type="number" min={editing.issuedCount} value={editing.totalCount}
                  onChange={(e) => setEditing({ ...editing, totalCount: Number(e.target.value) })} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>图标</label>
                <PrizeIconSelect value={editing.image} onChange={(image) => setEditing({ ...editing, image })} />
              </div>
              <div className="field">
                <label>颜色</label>
                <input className="input" type="color" style={{ padding: 4, height: 42 }} value={editing.color || '#FF9F1C'}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
              </div>
            </div>
            {editing.totalCount < editing.issuedCount && (
              <div className="notice" style={{ marginBottom: 12 }}>
                总数不能小于已发出数量（{editing.issuedCount}），需先撤回相应记录。
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" disabled={editing.totalCount < editing.issuedCount}
                onClick={() => { patchPrize(editing, { name: editing.name, level: editing.level, totalCount: editing.totalCount, photo: editing.photo || '', image: editing.image, color: editing.color }, '已保存'); setEditing(null); }}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤回 */}
      {revoking && (
        <div className="modal-mask" onClick={() => setRevoking(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>撤回这条中奖记录？</h3>
            <p>
              撤回后「{revoking.prizeNameSnapshot}」的库存会退回奖池，{userLabel(revoking)}（工号：{employeeNumber(revoking)}）可以重新抽一次。
              历史记录会保留并标记为已撤回。
            </p>
            <div className="field">
              <label>撤回原因（会展示给用户）</label>
              <textarea className="textarea" autoFocus placeholder="例如：重复参与 / 中奖信息有误"
                value={revoking.reason}
                onChange={(e) => setRevoking({ ...revoking, reason: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRevoking(null)}>取消</button>
              <button className="btn btn-danger" disabled={busy} onClick={revoke}>
                {busy ? '处理中…' : '确认撤回'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通用二次确认 */}
      {confirm && (
        <div className="modal-mask" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.title}</h3>
            <p>{confirm.desc}</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirm(null)}>取消</button>
              <button className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={confirm.fn}>
                {busy ? '处理中…' : confirm.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}








