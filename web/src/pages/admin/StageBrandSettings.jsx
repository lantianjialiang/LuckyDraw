import React,{useState,useEffect} from 'react';
import {api} from '../../api/client.js';
import {useToast} from '../../lib/toast.jsx';
export default function StageBrandSettings({id}){
 const [brand,setBrand]=useState({company:'',logo:'',background:''}),[busy,setBusy]=useState(false);const toast=useToast();
 useEffect(()=>{api.get(`/api/admin/lotteries/${id}`).then(d=>{if(d.lottery.stageBrand)setBrand(JSON.parse(d.lottery.stageBrand));}).catch(e=>toast(e.message,'error'));},[id]);
 const upload=async(e,key)=>{const file=e.target.files[0];if(!file)return;setBusy(true);try{
 const image=await createImageBitmap(file);const canvas=document.createElement('canvas');let side=key==='logo'?400:1920,quality=.85,data='';
 do{const scale=Math.min(1,side/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);data=canvas.toDataURL('image/webp',quality);side*=.8;quality=Math.max(.45,quality-.1);}while(data.length>1000000&&side>100);
 image.close();setBrand(b=>({...b,[key]:data}));toast(`图片已压缩至约 ${Math.round(data.length*.75/1024)} KB，保存后生效`,'success');
 }catch{toast('无法读取图片，请选择有效的图片文件','error');}finally{setBusy(false);e.target.value='';}};
 return <div className="card card-pad"><h3>品牌与背景</h3><p className="muted small">图片会自动缩放和压缩，包括超过 5MB 的原图。</p><label className="field">公司名称<input className="input" value={brand.company} maxLength={60} onChange={e=>setBrand({...brand,company:e.target.value})}/></label>{[['logo','品牌 Logo'],['background','舞台背景']].map(([key,label])=><div className="field" key={key}><label>{label}</label>{brand[key]&&<img src={brand[key]} alt={label} style={{maxWidth:'100%',height:140,objectFit:'contain',alignSelf:'flex-start'}}/>}<input type="file" accept="image/*" disabled={busy} onChange={e=>upload(e,key)}/><button className="btn btn-sm" disabled={busy} onClick={()=>setBrand({...brand,[key]:''})}>恢复默认</button></div>)}<button className="btn btn-primary" disabled={busy} onClick={async()=>{setBusy(true);try{await api.patch(`/api/admin/lotteries/${id}/stage-brand`,brand);toast('品牌设置已保存','success');}catch(e){toast(e.message,'error');}finally{setBusy(false);}}}>{busy?'处理中…':'保存品牌设置'}</button></div>;
}
