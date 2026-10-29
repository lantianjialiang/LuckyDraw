import React from 'react';
const icons = [['🎁','礼物'],['🏆','奖杯'],['📱','手机'],['💻','电脑'],['🎧','耳机'],['⌚','手表'],['📷','相机'],['💨','吹风机'],['🍟','厨房电器'],['🥤','保温杯'],['☕','咖啡'],['🎫','礼品券'],['💰','现金红包'],['🧧','红包'],['🧳','旅行箱'],['🌈','谢谢参与']];
export default function PrizeIconSelect({value, onChange}) {
 return <select className="select" aria-label="奖品图标" style={{width:'100%',maxWidth:180,height:42,flex:'0 0 auto'}} value={value || '🎁'} onChange={e => onChange(e.target.value)}>
 {!icons.some(([icon]) => icon === value) && value && <option value={value}>{value} 当前图标</option>}
 {icons.map(([icon,label]) => <option key={icon} value={icon}>{icon} {label}</option>)}
 </select>;
}

