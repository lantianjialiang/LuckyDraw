import {useParams,Link} from 'react-router-dom';
import React,{useState,useEffect} from 'react';
import {api} from '../../api/client.js';
import {useToast} from '../../lib/toast.jsx';
export default function AdminEmployees({embedded = false}){ const {id}=useParams();
 const [items,setItems]=useState([]),[busy,setBusy]=useState(false);const toast=useToast();
 const load=()=>api.get('/api/admin/lotteries/' + id + '/employees').then(d=>setItems(d.items));
 useEffect(()=>{load().catch(e=>toast(e.message,'error'));},[]);
 const download=(rows,name)=>{const blob=new Blob(['\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
 const upload=async e=>{const file=e.target.files[0];if(!file)return;setBusy(true);try{
 const text=(await file.text()).replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV 引号未闭合');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const header=rows.shift();if(header?.join(',')!=='工号,姓名,部门')throw Error('表头必须为：工号,姓名,部门');
 const entries=rows.filter(r=>r.some(v=>v.trim())).map(r=>{if(r.length!==3)throw Error('每行必须有工号、姓名、部门三列');return {employeeNo:r[0],displayName:r[1],department:r[2]};});
 const d=await api.post('/api/admin/lotteries/' + id + '/employees/import',{items:entries});toast(`已导入 ${d.count} 位员工`,'success');await load();
 }catch(err){toast(err.message,'error');}finally{setBusy(false);e.target.value='';}};
 return <><div className="admin-head"><div>{!embedded && <Link to={`/admin/lotteries/${id}`}>← 返回活动</Link>}<h2>本活动员工名册</h2><p>签到时严格校验工号、姓名及部门。相同工号导入后更新资料。</p></div></div><div className="card card-pad"><h3>导入格式示例</h3><p className="hint">每个活动独立维护名册，不同公司可使用相同工号。以下仅为格式示例，不会自动加入活动。</p><pre style={{padding:16,background:"var(--surface-2)",borderRadius:12}}>工号,姓名,部门{"\n"}A1024,张三,研发中心{"\n"}A1025,李四,市场部{"\n"}001026,王五,行政部</pre><div className="flex" style={{gap:12,flexWrap:'wrap'}}><label className="btn btn-primary">{busy?'导入中…':'导入 CSV'}<input hidden type="file" accept=".csv" disabled={busy} onChange={upload}/></label><button className="btn" onClick={()=>download([['工号','姓名','部门'],...items.map(r=>[r.employeeNo,r.displayName,r.department])],'员工名册.csv')}>导出名册</button><button className="btn" onClick={()=>download([['工号','姓名','部门'],['A1024','张三','研发中心']],'员工导入模板.csv')}>下载模板</button></div><p className="hint">请使用 UTF-8 CSV 文件，最多 10000 行；工号应保存为文本以保留前导零。导入前会验证全部行，不会部分写入。</p><div className="stack">{items.length===0?<p className="muted">尚未导入名册，现场签到暂不可用。</p>:items.map(r=><div className="prize-row" key={r.employeeNo}><b style={{minWidth:100}}>{r.employeeNo}</b><span style={{flex:1}}>{r.displayName}</span><span className="muted">{r.department}</span></div>)}</div></div></>;
}


