const BASE = '';

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export function getToken() {
  return localStorage.getItem('ld_token') || '';
}
export function setToken(token) {
  if (token) localStorage.setItem('ld_token', token);
  else localStorage.removeItem('ld_token');
}

export class ApiError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(err.message || `请求失败 (${res.status})`, err.code, res.status, err.details);
  }
  return data;
}

export const api = {
  get: (p, opt) => request(p, { ...opt, method: 'GET' }),
  post: (p, body, opt) => request(p, { ...opt, method: 'POST', body }),
  patch: (p, body, opt) => request(p, { ...opt, method: 'PATCH', body }),
  del: (p, opt) => request(p, { ...opt, method: 'DELETE' }),

  /* ---- 年会现场模式 ---- */
  checkin: (payload) => request('/api/auth/checkin', { method: 'POST', body: payload }),
  enrollments: (lotteryId) => request(`/api/lotteries/${lotteryId}/enrollments`),
  myEnrollment: (lotteryId) => request(`/api/lotteries/${lotteryId}/my-enrollment`),
  adminEnrollments: (lotteryId, keyword = '') =>
    request(`/api/admin/lotteries/${lotteryId}/enrollments${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`),
  raffle: (lotteryId, prizeId, count) =>
    request(`/api/admin/lotteries/${lotteryId}/raffle`, { method: 'POST', body: { prizeId, count } }),
  revokeBatch: (batchId, reason) =>
    request(`/api/admin/batches/${batchId}/revoke`, { method: 'POST', body: { reason } }),
};
