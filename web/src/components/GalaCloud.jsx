import React,{useEffect,useRef} from 'react';
import Avatar from './Avatar.jsx';
export default function GalaCloud({people,running,mode,speed=3}){
 const root=useRef(),fast=useRef(running),rate=useRef(speed);rate.current=speed;fast.current=running;
 useEffect(()=>{let frame,last=0,t=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const animate=now=>{t+=Math.min((now-last)/1000||0,.05)*(reduced?0:fast.current?rate.current:.13);last=now;
 const el=root.current;if(el){const w=el.clientWidth,h=el.clientHeight,r=Math.min(w*.38,h*.43);Array.from(el.children).forEach((node,i)=>{const n=people.length,y=1-2*(i+.5)/n,a=i*2.399963+t;let x=Math.cos(a)*Math.sqrt(1-y*y),z=Math.sin(a)*Math.sqrt(1-y*y),v=y;
 if(mode==='galaxy'){const orbit=.25+.75*((i*37%101)/100);x=Math.cos(a)*orbit;v=Math.sin(a)*orbit*.65;z=Math.sin(a*.7+i);}
 const scale=.35+(z+1)*.55;node.style.transform=`translate(-50%,-50%) translate(${x*r*1.25}px,${v*r}px) scale(${scale})`;node.style.opacity=.18+(z+1)*.41;node.style.zIndex=Math.round((z+1)*100);});}frame=requestAnimationFrame(animate);};frame=requestAnimationFrame(animate);return()=>cancelAnimationFrame(frame);},[people,mode]);
 return <div className="gala-cloud" ref={root}>{people.map((p,i)=><div className="gala-person" key={p.userId||i} title={p.displayName}><Avatar avatar={p.avatar} avatarKind={p.avatarKind} name={p.displayName} size={66}/><span>{p.displayName}</span></div>)}</div>;
}

