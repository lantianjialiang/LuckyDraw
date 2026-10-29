import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useToast } from '../../lib/toast.jsx';

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'active', label: '进行中' },
  { key: 'ended', label: '已结束' },
];

const STATUS = {
  draft: { cls: 'badge-draft', text: '草稿' },
  active: { cls: 'badge-live', text: '进行中' },
  ended: { cls: 'badge-ended', text: '已结束' },
};

const emptyForm = {
  title: '', description: '', startAt: '', endAt: '', maxDrawsPerUser: 1,
  autoEndWhenEmpty: false, excludeLastOnRedraw: true,
  mode: 'online', checkinHint: '',
};

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminLotteries() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/admin/lotteries${filter ? `?status=${filter}` : ''}`);
      setItems(d.lotteries || []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.title.trim()) { toast('请填写活动标题', 'error'); return; }
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        maxDrawsPerUser: Number(form.maxDrawsPerUser) || 1,
        autoEndWhenEmpty: form.autoEndWhenEmpty,
        excludeLastOnRedraw: form.excludeLastOnRedraw,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
        mode: form.mode,
        checkinHint: form.mode === 'onsite' ? form.checkinHint : '',
      };
      const d = await api.post('/api/admin/lotteries', payload);
      toast('活动已创建，接下来添加奖品', 'success');
      navigate(`/admin/lotteries/${d.lottery.id}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const totalActive = items.filter((i) => i.status === 'active').length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>抽奖活动</h1>
          <p>{items.length} 个活动 · {totalActive} 个进行中</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setCreating(true); }}>
          + 新建活动
        </button>
      </div>

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} className={`tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card skeleton" style={{ height: 220 }} />
      ) : items.length === 0 ? (
        <div className="card empty">
          <span className="empty-icon">🎪</span>
          这里还没有活动
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>创建第一个活动</button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {items.map((l) => {
            const st = STATUS[l.status] || STATUS.draft;
            return (
              <div key={l.id} className="card card-pad flex activity-list-card" style={{ gap: 18 }}>
                <Link to={`/admin/lotteries/${l.id}`} className="activity-card-link" aria-label={`管理活动：${l.title}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex" style={{ gap: 8, marginBottom: 7 }}>
                    <span className={`badge ${st.cls}`}><i className="badge-dot" />{st.text}</span>
                    <span className="small mono muted">{l.shareCode || '未发布'}</span>
                  </div>
                  <div style={{ fontWeight: 750, fontSize: 16, marginBottom: 4 }}>{l.title}</div>
                  <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.description || '暂无描述'}
                  </div>
                </div>
                <div className="flex" style={{ gap: 26, flexShrink: 0 }}>
                  <div className="center">
                    <div className="mono" style={{ fontSize: 19, fontWeight: 800 }}>{l.prizeCount}</div>
                    <div className="small muted">奖项</div>
                  </div>
                  <div className="center">
                    <div className="mono" style={{ fontSize: 19, fontWeight: 800, color: 'var(--gold)' }}>{l.poolRemaining}</div>
                    <div className="small muted">剩余</div>
                  </div>
                  <div className="center">
                    <div className="mono" style={{ fontSize: 19, fontWeight: 800 }}>{l.records.won + l.records.claimed}</div>
                    <div className="small muted">已中奖</div>
                  </div>
                </div>

                <button type="button" className="btn btn-sm btn-danger activity-delete" disabled={busy} onClick={async () => {
                  if (!window.confirm(`确认删除「${l.title}」？\n\n活动、奖品、签到资料、参与及中奖记录将永久丢失，分享链接也将失效。此操作无法撤销。`)) return;
                  setBusy(true);
                  try {
                    await api.del(`/api/admin/lotteries/${l.id}`);
                    toast('活动已删除', 'success');
                    await load();
                  } catch (err) { toast(err.message, 'error'); }
                  finally { setBusy(false); }
                }}>删除活动</button>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <div className="modal-mask" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3>新建抽奖活动</h3>
            <p>先创建草稿，添加奖品后再发布生成分享链接。</p>
            <div className="field">
              <label>活动标题 *</label>
              <input className="input" autoFocus value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例如：2026 年会幸运大转盘" />
            </div>
            <div className="field">
              <label>活动说明</label>
              <textarea className="textarea" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="中奖后如何领取、注意事项等" />
            </div>
            <div className="row">
              <div className="field">
                <label>开始时间</label>
                <input className="input" type="datetime-local" value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
              </div>
              <div className="field">
                <label>结束时间</label>
                <input className="input" type="datetime-local" value={form.endAt}
                  onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>抽奖方式</label>
              <select className="select" value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="online">自助抽奖 — 用户打开链接自己转盘</option>
                <option value="onsite">年会现场 — 先签到，主持人按奖项逐一开奖</option>
              </select>
              <span className="hint">
                {form.mode === 'onsite'
                  ? '参与者用工号+姓名签到，可上传头像、留下祝福语；你在「抽奖台」按奖项抽取，支持回退重抽。'
                  : '用户打开分享链接即可转盘，每人限一次。'}
              </span>
            </div>
            {form.mode === 'onsite' && (
              <div className="field">
                <label>签到提示语</label>
                <input className="input" value={form.checkinHint} maxLength={120}
                  placeholder="例如：请用工号+姓名签到，并留下你的新年祝福"
                  onChange={(e) => setForm({ ...form, checkinHint: e.target.value })} />
              </div>
            )}
            <div className="row">
              <div className="field">
                <label>每人可抽次数</label>
                <input className="input" type="number" min="1" max="100" value={form.maxDrawsPerUser}
                  onChange={(e) => setForm({ ...form, maxDrawsPerUser: e.target.value })} />
              </div>
              <div className="field">
                <label>奖池抽完</label>
                <select className="select" value={form.autoEndWhenEmpty ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, autoEndWhenEmpty: e.target.value === '1' })}>
                  <option value="0">保持开放（可补货）</option>
                  <option value="1">自动结束活动</option>
                </select>
              </div>
            </div>
            <label className="flex small muted" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.excludeLastOnRedraw}
                onChange={(e) => setForm({ ...form, excludeLastOnRedraw: e.target.checked })} />
              撤回后重抽时，排除刚被撤回的奖品
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setCreating(false)}>取消</button>
              <button className="btn btn-primary" disabled={busy} onClick={create}>
                {busy ? '创建中…' : '创建活动'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}



