export function userLabel(user) {
  if (user?.displayName?.trim()) return user.displayName.trim();
  const username = user?.username || '';
  if (username.startsWith('emp:')) return `员工 ${username.split(':').pop()}`;
  return username || '用户';
}

export function employeeNumber(user) {
  if (user?.employeeNo) return String(user.employeeNo);
  return user?.username?.startsWith('emp:') ? user.username.split(':').pop() : '—';
}
