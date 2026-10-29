/** 给指定分享码的活动签到一批演示人员：node scripts/seed-people.mjs <shareCode> [count] */
const API = 'http://localhost:4000/api';
const code = process.argv[2];
const count = Number(process.argv[3] || 16);
if (!code) { console.error('用法: node scripts/seed-people.mjs <shareCode> [count]'); process.exit(1); }

const NAMES = ['张伟', '王芳', '李娜', '刘洋', '陈静', '赵磊', '孙强', '周敏', '吴超', '郑爽',
  '冯刚', '蒋雯', '韩雪', '曹阳', '沈磊', '许诺', '邓超', '范冰'];
const DEPTS = ['研发中心', '市场部', '人力资源', '财务部', '产品部', '客户成功'];
const BLESSINGS = [
  '新年快乐，万事顺意！', '祝公司蒸蒸日上，业绩长虹', '愿今年心想事成', '抽到大奖请大家吃饭',
  '感谢一路同行，新年继续加油', '祝大家身体健康，钱包鼓鼓', '新的一年，一起冲！', '好运连连，喜乐平安',
];
const AVATARS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

for (let i = 0; i < Math.min(count, NAMES.length); i++) {
  const res = await fetch(`${API}/auth/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shareCode: code,
      employeeNo: `E${2001 + i}`,
      displayName: NAMES[i],
      department: DEPTS[i % DEPTS.length],
      blessing: BLESSINGS[i % BLESSINGS.length],
      avatar: AVATARS[i % AVATARS.length],
      avatarKind: 'preset',
    }),
  });
  const j = await res.json();
  if (!res.ok) console.error('失败', NAMES[i], j?.error?.message);
}
const wall = await fetch(`${API}/lotteries/share/${code}`).then((r) => r.json());
console.log('签到完成，当前人数:', wall.lottery?.checkinCount, 'lottery=', wall.lottery?.id);
