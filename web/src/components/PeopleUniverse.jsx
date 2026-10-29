import React, { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';

export default function PeopleUniverse({ items, running, mode }) {
  const root = useRef(null);
  const speed = useRef(running);
  useEffect(() => { speed.current = running; }, [running]);
  useEffect(() => {
    let frame, last = 0, angle = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (time) => {
      const dt = Math.min((time - last) / 1000 || 0, .05); last = time;
      angle += dt * (reduced ? 0 : speed.current ? 2.8 : .16);
      const el = root.current;
      if (el) {
        const radius = Math.min(el.clientWidth * .34, el.clientHeight * .36, 240);
        Array.from(el.children).forEach((node, i) => {
          const n = items.length;
          const y = mode === 'ring' ? Math.sin(i * 2.399) * .22 : 1 - 2 * (i + .5) / n;
          const r = Math.sqrt(1 - y * y);
          const a = i * 2.399963 + angle;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          const scale = .62 + (z + 1) * .27;
          node.style.transform = `translate(-50%, -50%) translate(${x * radius}px, ${(y * .9 + z * .18) * radius}px) scale(${scale})`;
          node.style.opacity = .25 + (z + 1) * .375;
          node.style.zIndex = Math.round((z + 1) * 100);
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [items, mode]);
  return <div className={`universe ${running ? 'is-running' : ''}`}>
    <div className="universe-orbit orbit-one" /><div className="universe-orbit orbit-two" />
    <div className="universe-core" />
    {!items.length && <div className="universe-empty">等待第一颗幸运之星<br /><small>签到后，头像与祝福将在这里相遇</small></div>}
    <div className="universe-people" ref={root}>{items.map((p, i) => <div className="universe-person" key={p.userId || p.employeeNo || i} title={`${p.displayName} · ${p.blessing || ''}`}>
      <Avatar avatar={p.avatar} avatarKind={p.avatarKind} name={p.displayName} size={42} />
      <b>{p.displayName}</b>{p.blessing && <span>{p.blessing}</span>}
    </div>)}</div>
    <div className="universe-caption"><i />{running ? '幸运正在靠近 · DRAWING' : '每一份期待，都在闪耀 · LUCKY UNIVERSE'}</div>
  </div>;
}
