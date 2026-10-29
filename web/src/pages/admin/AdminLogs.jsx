import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../lib/toast.jsx';

const ACTION_LABEL = {
  'lottery.create': '创建活动',
  'lottery.update': '修改活动',
  'lottery.delete': '删除活动',
  'lottery.publish': '发布活动',
  'lottery.end': '结束活动',
  'lottery.reopen': '重新开启',
  'prize.create': '添加奖品',
  'prize.update': '修改奖品',
  'prize.disable': '下架奖品',
  'prize.enable': '上架奖品',
  'prize.delete': '删除奖品',
  'prize.disable_existing_records': '下架奖品（保留记录）',
  'record.revoke': '撤回中奖',
  'record.claim': '标记领取',
};

export default function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api.get('/api/admin/logs')
      .then((d) => setLogs(d.logs || []))
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>操作日志</h1>
          <p>最近 200 条后台操作，用于异常追溯</p>
        </div>
      </div>

      {loading ? (
        <div className="card skeleton" style={{ height: 240 }} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>变更详情</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono small muted" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(l.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td>{l.adminName || '—'}</td>
                  <td><span className="badge badge-draft">{ACTION_LABEL[l.action] || l.action}</span></td>
                  <td className="mono small muted">{l.targetType}</td>
                  <td className="small" style={{ maxWidth: 420 }}>
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
    </>
  );
}
