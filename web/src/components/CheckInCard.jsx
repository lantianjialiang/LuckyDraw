import React, { useEffect, useRef, useState } from 'react';
import Avatar, { PRESET_AVATARS } from './Avatar.jsx';
import { api } from '../api/client.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

/** 把上传的图片压成正方形缩略图 dataURL，避免把几 MB 的原图塞进数据库 */
function compressImage(file, maxSize = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function CheckInCard({ lottery, onDone, initial = null }) {
  const { applyToken } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);

  const [form, setForm] = useState(() => (initial
    ? {
      employeeNo: initial.employeeNo || '',
      displayName: initial.displayName || '',
      department: initial.department || '',
      blessing: initial.blessing || '',
      avatar: initial.avatar || PRESET_AVATARS[0].id,
      avatarKind: initial.avatarKind || 'preset',
    }
    : {
      employeeNo: '',
      displayName: '',
      department: '',
      blessing: '',
      avatar: PRESET_AVATARS[0].id,
      avatarKind: 'preset',
    }));
  const [departments, setDepartments] = useState([]);
  useEffect(() => { api.get('/api/lotteries/departments/' + lottery.shareCode).then(d => setDepartments(d.departments)).catch(() => toast('部门加载失败，请刷新重试', 'error')); }, [lottery.shareCode]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pickPreset = (id) => setForm((f) => ({ ...f, avatar: id, avatarKind: 'preset' }));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('图片太大了，请选择 8MB 以内的照片', 'error'); return; }
    setUploading(true);
    try {
      const dataUrl = await compressImage(file);
      setForm((f) => ({ ...f, avatar: dataUrl, avatarKind: 'photo' }));
      toast('头像已就绪', 'success');
    } catch (err) {
      toast(err.message || '图片处理失败', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.employeeNo.trim()) { toast('请填写工号', 'error'); return; }
    if (!form.displayName.trim()) { toast('请填写姓名', 'error'); return; }
    setBusy(true);
    try {
      const res = await api.checkin({ ...form, shareCode: lottery.shareCode });
      await applyToken(res.token);
      toast(res.updated ? '签到信息已更新' : '签到成功，等待开奖 🎉', 'success');
      onDone?.(res.enrollment);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card card-pad checkin-card" onSubmit={submit}>
      <h3 className="card-title">现场签到</h3>
      {lottery.checkinHint && <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>{lottery.checkinHint}</p>}

      <div className="checkin-avatar-row">
        <Avatar avatar={form.avatar} avatarKind={form.avatarKind} name={form.displayName} size={78} ring />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="preset-grid">
            {PRESET_AVATARS.map((a) => (
              <button
                type="button"
                key={a.id}
                className={`preset-dot ${form.avatarKind === 'preset' && form.avatar === a.id ? 'active' : ''}`}
                style={{ background: `linear-gradient(145deg, ${a.from}, ${a.to})` }}
                onClick={() => pickPreset(a.id)}
                title="选这个头像"
              >
                {a.emoji}
              </button>
            ))}
          </div>
          <div className="flex" style={{ marginTop: 10, gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? '处理中…' : '📷 上传照片'}
            </button>
            {form.avatarKind === 'photo' && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => pickPreset(PRESET_AVATARS[0].id)}>
                改用预设
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>工号 *</label>
          <input
            className="input" value={form.employeeNo} placeholder="例如 A1024"
            onChange={(e) => setForm({ ...form, employeeNo: e.target.value })}
          />
        </div>
        <div className="field">
          <label>姓名 *</label>
          <input
            className="input" value={form.displayName} placeholder="你的名字"
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label>部门 / 团队</label>
        <select required className="select" value={form.department} onChange={e => setForm({...form, department:e.target.value})}><option value="">请选择部门</option>{departments.map(d => <option key={d} value={d}>{d}</option>)}</select>
      </div>

      <div className="field">
        <label>新年祝福语</label>
        <textarea
          className="textarea" value={form.blessing} maxLength={120} placeholder="留下一句祝福，会显示在大屏上"
          onChange={(e) => setForm({ ...form, blessing: e.target.value })}
        />
        <span className="hint" style={{ textAlign: 'right' }}>{form.blessing.length}/120</span>
      </div>

      <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy}>
        {busy ? '签到中…' : '签到，等待开奖'}
      </button>
      <p className="hint center" style={{ marginTop: 12 }}>
        同一工号重复签到会覆盖资料，不会重复占用名额。
      </p>
    </form>
  );
}



