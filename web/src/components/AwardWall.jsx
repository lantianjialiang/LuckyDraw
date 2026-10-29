import {userLabel,employeeNumber} from '../lib/userLabel.js';
import React,{useEffect,useRef,useState} from 'react';
import Avatar from './Avatar.jsx';
export default function AwardWall({groups,people,onClose,total,currentPrize}){
 const body=useRef(),[capacity,setCapacity]=useState(8),[page,setPage]=useState(0);
 useEffect(()=>{const observer=new ResizeObserver(([entry])=>setCapacity(Math.max(2,Math.floor(entry.contentRect.height/64)*2)));observer.observe(body.current);return()=>observer.disconnect();},[]);
 const shownGroups=currentPrize&&!groups.some(g=>g.key===currentPrize.id)?[{key:currentPrize.id,name:currentPrize.name,level:currentPrize.level,items:[]},...groups]:groups;
 const pages=shownGroups.flatMap(g=>Array.from({length:Math.max(1,Math.ceil(g.items.length/capacity))},(_,i)=>({...g,items:g.items.slice(i*capacity,(i+1)*capacity),part:i+1})));
 useEffect(()=>{const index=pages.findIndex(g=>g.key===currentPrize?.id);setPage(index<0?0:index);},[currentPrize?.id,capacity]);
 const index=Math.min(page,Math.max(0,pages.length-1)),current=pages[index];
 return <aside className="gala-award-wall"><div className="gala-wall-heading"><h2>获奖墙 <small>{total} 人</small></h2><button aria-label="隐藏获奖墙" onClick={onClose}>×</button></div><h3 className="award-page-title">{current?.level||'中奖名单'}<small>{current?.name||'尚无中奖记录'}</small></h3><div className="award-page-grid" ref={body}>{current?.items.map(r=>{const p=people.find(x=>x.userId===r.userId);return <article key={r.id}><Avatar avatar={p?.avatar} avatarKind={p?.avatarKind} name={p?.displayName||userLabel(r)} size={32}/><div><b>{p?.displayName||userLabel(r)}</b><small title={`工号：${employeeNumber(p || r)}`}>{employeeNumber(p || r)}</small></div></article>;})}</div><nav className="award-pagination"><button disabled={index===0} onClick={()=>setPage(index-1)}>‹</button><span>{pages.length?index+1:0} / {pages.length}</span><button disabled={index>=pages.length-1} onClick={()=>setPage(index+1)}>›</button></nav></aside>;
}




