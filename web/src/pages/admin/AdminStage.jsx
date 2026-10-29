import AwardWall from '../../components/AwardWall.jsx';
import React,{useEffect,useRef,useState,useCallback} from 'react';
import {useParams,useNavigate} from 'react-router-dom';
import {api} from '../../api/client.js';
import {useToast} from '../../lib/toast.jsx';
import {sfx} from '../../lib/sound.js';
import Avatar from '../../components/Avatar.jsx';
import GalaCloud from '../../components/GalaCloud.jsx';
import Confetti from '../../components/Confetti.jsx';
import './gala.css';
export default function AdminStage(){
 const {id}=useParams(),navigate=useNavigate(),toast=useToast(),root=useRef(),lock=useRef(false);
 const [lottery,setLottery]=useState(null),[people,setPeople]=useState([]),[prizes,setPrizes]=useState([]),[eligible,setEligible]=useState(0),[prizeId,setPrizeId]=useState(''),[count,setCount]=useState(1),[phase,setPhase]=useState('idle'),[winners,setWinners]=useState([]),[resultPrize,setResultPrize]=useState(null),[panel,setPanel]=useState(false),[mode,setMode]=useState('sphere'),[sound,setSound]=useState(sfx.enabled),[comments,setComments]=useState(false),[fullscreen,setFullscreen]=useState(false),[batch,setBatch]=useState(null),[busy,setBusy]=useState(false);
 const settingsButton=useRef(),animationButton=useRef();
 const [anchor,setAnchor]=useState({left:0,bottom:100});
 const place=ref=>{const r=ref.current.getBoundingClientRect();setAnchor({left:Math.max(190,Math.min(window.innerWidth-190,r.left+r.width/2)),bottom:window.innerHeight-r.top+16});};
 const [animationPanel,setAnimationPanel]=useState(false);
 const [speed,setSpeed]=useState(3),[wall,setWall]=useState(false),[records,setRecords]=useState([]);
 const [brand,setBrand]=useState({company:'',logo:'',background:''});
 const load=useCallback(async()=>{try{const [l,e,r]=await Promise.all([api.get(`/api/admin/lotteries/${id}`),api.adminEnrollments(id),api.get(`/api/admin/lotteries/${id}/records?pageSize=200`)]);setRecords(r.records.filter(x=>x.status!=='revoked'));setLottery(l.lottery);setPeople(e.items);setEligible(e.eligible);setPrizes(l.stats.prizes.filter(p=>p.status==='active'));setPrizeId(prev=>prev||l.stats.prizes.find(p=>p.status==='active'&&p.remainingCount>0)?.id||'');if(l.lottery.stageBrand)setBrand(JSON.parse(l.lottery.stageBrand));}catch(e){toast(e.message,'error');}},[id,toast]);
 useEffect(()=>{load();},[load]);
 useEffect(()=>{if(phase!=='idle')return;const t=setInterval(load,10000);return()=>clearInterval(t);},[phase,load]);
 useEffect(()=>{const fn=()=>setFullscreen(Boolean(document.fullscreenElement));document.addEventListener('fullscreenchange',fn);return()=>document.removeEventListener('fullscreenchange',fn);},[]);
 const prize=prizes.find(p=>p.id===prizeId),max=Math.min(50,eligible,prize?.remainingCount||0),running=phase==='rolling';
 useEffect(()=>{const close=e=>{if(e.key==="Escape"){setPanel(false);setAnimationPanel(false);}};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[]);
 const groups=Object.values(records.reduce((all,r)=>{const key=r.prizeId||r.prizeNameSnapshot;if(!all[key])all[key]={key,name:r.prizeNameSnapshot,level:r.prizeLevelSnapshot,items:[]};all[key].items.push(r);return all;},{})).sort((a,b)=>{const rank=g=>{const level=g.level||"";if(/特等|特奖|大奖/.test(level))return 0;const m=level.match(/([一二三四五六七八九十]|\d+)等奖/);if(m)return Number(m[1])||"一二三四五六七八九十".indexOf(m[1])+1;return 100+(prizes.find(p=>p.id===g.key)?.sortOrder||0);};return rank(a)-rank(b);});
 const start=()=>{if(lock.current||!prize||count>max||count<1)return;setWinners([]);setResultPrize({...prize});setPanel(false);setAnimationPanel(false);setPhase('rolling');sfx.whoosh();};
 const supplement=()=>{const p=prizes.find(x=>x.id===resultPrize?.id);if(busy||lock.current||!p||p.remainingCount<1||eligible<1)return;setPrizeId(p.id);setCount(1);setWinners([]);setResultPrize({...p});setPanel(false);setPhase("rolling");sfx.whoosh();};
 const stop=async()=>{if(lock.current)return;lock.current=true;setBusy(true);try{const r=await api.raffle(id,prizeId,count);setWinners(r.winners);setBatch(r.batchId);setPhase('result');sfx.win();await load();}catch(e){toast(e.message,'error');setPhase('idle');}finally{lock.current=false;setBusy(false);}};
 const undo=async()=>{if(!batch||!confirm('回退本轮中奖结果，恢复库存并允许重新抽取？'))return;setBusy(true);try{await api.revokeBatch(batch,'现场回退');setPhase('idle');setWinners([]);setBatch(null);await load();}catch(e){toast(e.message,'error');}finally{setBusy(false);}};
 const full=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current.requestFullscreen();}catch{toast('浏览器未允许全屏，当前已使用铺满窗口模式','info');}};
 return <div className="gala" ref={root} style={brand.background?{backgroundImage:`linear-gradient(#0009,#000b),url(${brand.background})`}:undefined}>
 <div className="gala-stars"/>
 <header className="gala-header">{!fullscreen ? <button className="gala-pill" disabled={running||busy} onClick={()=>navigate(`/admin/lotteries/${id}`)}>← 活动管理</button> : <span />}<div className="gala-brand">{brand.logo&&<img src={brand.logo} alt="品牌标志"/>}<div><small>{brand.company||'ANNUAL CELEBRATION'}</small><h1>{lottery?.title||'年度幸运盛典'}</h1></div></div><button className="gala-start" disabled={busy||(!running&&(max<1||count>max))} onClick={running?stop:start}>{busy?'开奖中…':running?'停止 · 揭晓':phase==='result'?'再抽一轮':'开始抽奖'}</button></header>
 {phase==='result'?<section className="gala-results"><small>{resultPrize?.level} · {resultPrize?.name}</small><h2>恭喜以下中奖者</h2><div className="gala-winners">{winners.map(w=><article key={w.recordId}><Avatar avatar={w.avatar} avatarKind={w.avatarKind} name={w.displayName} size={110}/><h3>{w.displayName}</h3><p>{w.department} · {w.employeeNo}</p>{w.blessing&&<blockquote>{w.blessing}</blockquote>}</article>)}</div><button className="gala-pill" disabled={busy||eligible<1||!(prizes.find(p=>p.id===resultPrize?.id)?.remainingCount>0)} onClick={supplement}>再补抽一位</button> <button className="gala-pill" disabled={busy} onClick={undo}>回退本轮</button></section>:<><GalaCloud people={people} running={running} mode={mode} speed={speed}/>{!people.length&&<div className="gala-empty"><h2>等待幸运星辰入场</h2><p>参与者签到后，头像将在这里汇聚</p></div>}</>}
 <Confetti active={phase==='result'} tone="cool" continuous/>
 {comments&&<div className="gala-comments">{people.filter(p=>p.blessing).slice(0,12).map((p,i)=><span key={p.userId} style={{animationDelay:`${-i*3}s`,top:`${18+i%5*12}%`}}>{p.displayName}：{p.blessing}</span>)}</div>}
 <footer className="gala-footer"><div className="gala-counter"><b>{people.length}</b> 人已签到 <span>· {eligible} 人待开奖</span></div><div className="gala-prize"><small>{prize?.level||'本轮奖项'} · 抽取 {count} 位</small>{prize?.photo&&<img className="gala-prize-photo" src={prize.photo} alt="奖品实物"/>}<strong>{prize?.name||'请设置奖项'}</strong><span>剩余 {prize?.remainingCount||0} 份</span></div><div className="gala-tools"><button aria-pressed={wall} onClick={()=>setWall(!wall)}>获奖墙<small>{records.length} 人</small></button><button ref={settingsButton} disabled={running||busy} aria-expanded={panel} onClick={()=>{place(settingsButton);setPanel(!panel);setAnimationPanel(false);}}>设置<small>奖项 / 速度</small></button><button ref={animationButton} aria-expanded={animationPanel} onClick={()=>{place(animationButton);setAnimationPanel(!animationPanel);setPanel(false);}}>{mode==='sphere'?'球体':'星河'}<small>切换动画</small></button><button onClick={()=>{sfx.setEnabled(!sound);setSound(!sound);}}>音效<small>{sound?'已开启':'已关闭'}</small></button><button onClick={()=>setComments(!comments)}>弹幕<small>{comments?'已开启':'已关闭'}</small></button><button onClick={full}>{fullscreen?'退出':'全屏'}<small>屏幕显示</small></button></div></footer>
 {wall&&<AwardWall currentPrize={prize} groups={groups} people={people} total={records.length} onClose={()=>setWall(false)}/>}
 {(panel||animationPanel)&&<div className="gala-popover-dismiss" onClick={()=>{setPanel(false);setAnimationPanel(false);}}/>}
 {animationPanel&&<section className="gala-animation-popover" style={anchor} role="dialog" aria-label="选择抽奖动画"><h3>抽取动画</h3><div className="gala-animation-options">{[['sphere','幸运球体'],['galaxy','旋转星河']].map(([value,label])=><button key={value} className={mode===value?'selected':''} aria-pressed={mode===value} onClick={()=>{setMode(value);setAnimationPanel(false);}}><div className="gala-animation-preview"><GalaCloud people={people.length?people.slice(0,36):Array.from({length:24},(_,i)=>({userId:`preview-${i}`,avatar:`a${i%12+1}`,displayName:''}))} running={false} mode={value}/></div><span>{mode===value?'◉':'○'} {label}</span></button>)}</div></section>} {panel&&<aside className="gala-panel gala-settings-popover" style={anchor} role="dialog" aria-label="现场抽奖设置"><button className="gala-pill" onClick={()=>setPanel(false)}>关闭设置 ×</button><h2>现场抽奖设置</h2><label>选择奖项<select value={prizeId} onChange={e=>{setPrizeId(e.target.value);setCount(1);}}>{prizes.map(p=><option key={p.id} value={p.id}>{p.level} · {p.name}（剩 {p.remainingCount}）</option>)}</select></label><label>本轮人数（最多 {max}）<input type="number" min="1" max={max} value={count} onChange={e=>setCount(Math.max(1,Math.min(max||1,Math.floor(Number(e.target.value)||1))))}/></label><label>动画速度：{speed.toFixed(1)} ×<input type="range" min="1" max="8" step="0.5" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></label></aside>}
 </div>;
}





