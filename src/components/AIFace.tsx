
import React, { useEffect, useState } from "react";
import { AssistantState } from "../types/assistant";
interface AIFaceProps { state: AssistantState; micLevel: number; outputLevel: number; className?: string; }

export const AIFace: React.FC<AIFaceProps> = ({ state, micLevel, outputLevel, className = "" }) => {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let dead = false;
    const loop = () => {
      const timer = window.setTimeout(() => {
        if (dead) return;
        setBlink(true);
        window.setTimeout(() => !dead && setBlink(false), 110);
        loop();
      }, 2600 + Math.random() * 2600);
      return timer;
    };
    const timer = loop();
    return () => { dead = true; window.clearTimeout(timer); };
  }, []);
  const level = Math.min(1, Math.max(0, state === "speaking" ? outputLevel : micLevel));
  const speaking = state === "speaking";
  const listening = state === "listening";
  const thinking = state === "thinking";
  const accent = speaking ? "#68e8ff" : listening ? "#00f6c7" : thinking ? "#9b8cff" : "#20d9ff";
  const eyeY = thinking ? 3 : listening ? -1 : 0;
  const mouthRy = speaking ? 3 + level * 18 : 1.5;
  return (
    <div className={"relative flex items-center justify-center overflow-hidden " + className}>
      <div className="absolute inset-[8%] rounded-full border border-cyan-300/10 shadow-[0_0_70px_rgba(32,217,255,.08)]" />
      <div className={"absolute inset-[15%] rounded-[48%] border border-cyan-200/10 bg-cyan-300/[0.015] " + (thinking ? "animate-pulse" : "")} />
      <svg viewBox="0 0 320 360" className="relative h-full w-full drop-shadow-[0_0_18px_rgba(32,217,255,.32)]">
        <defs>
          <radialGradient id="jarvisFaceGlow" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor={accent} stopOpacity=".18"/><stop offset="68%" stopColor={accent} stopOpacity=".055"/><stop offset="100%" stopColor={accent} stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="jarvisFaceStroke" x1="0" x2="1">
            <stop offset="0%" stopColor={accent} stopOpacity=".12"/><stop offset="45%" stopColor={accent} stopOpacity=".9"/><stop offset="100%" stopColor={accent} stopOpacity=".12"/>
          </linearGradient>
        </defs>
        <ellipse cx="160" cy="178" rx="128" ry="150" fill="url(#jarvisFaceGlow)"/>
        <path d="M72 118 Q83 43 160 34 Q237 43 248 118 L239 252 Q218 316 160 329 Q102 316 81 252Z" fill="none" stroke="url(#jarvisFaceStroke)" strokeWidth="2.2"/>
        <path d="M87 120 Q96 61 160 51 Q224 61 233 120" fill="none" stroke={accent} strokeOpacity=".22"/>
        <path d="M79 178 Q52 205 66 252 M241 178 Q268 205 254 252" fill="none" stroke={accent} strokeOpacity=".18"/>
        <g stroke={accent} fill="none" strokeLinecap="round">
          <path d={"M98 " + (154 + eyeY) + " Q119 " + (145 + eyeY) + " 138 " + (154 + eyeY)} strokeWidth="3" opacity=".9"/>
          <path d={"M182 " + (154 + eyeY) + " Q201 " + (145 + eyeY) + " 222 " + (154 + eyeY)} strokeWidth="3" opacity=".9"/>
          <ellipse cx="118" cy={154 + eyeY} rx="7" ry={blink ? 1 : 5} fill={accent} fillOpacity=".72" stroke="none"/>
          <ellipse cx="202" cy={154 + eyeY} rx="7" ry={blink ? 1 : 5} fill={accent} fillOpacity=".72" stroke="none"/>
          <path d="M151 163 Q160 172 169 163" strokeWidth="1.5" opacity=".4"/>
          <path d="M147 196 Q160 202 173 196" strokeWidth="1.3" opacity=".42"/>
          <ellipse cx="160" cy="236" rx={25 + level * 5} ry={mouthRy} strokeWidth="2.4" fill={accent} fillOpacity={speaking ? ".08" : ".025"}/>
        </g>
        <g fill={accent} opacity=".34"><circle cx="84" cy="136" r="2"/><circle cx="236" cy="136" r="2"/><circle cx="88" cy="270" r="1.7"/><circle cx="232" cy="270" r="1.7"/></g>
        <path d={"M52 306 Q160 " + (326 + level * 4) + " 268 306"} fill="none" stroke={accent} strokeOpacity=".12"/>
      </svg>
      <div className="absolute bottom-[8%] rounded-full border border-cyan-300/10 bg-black/20 px-3 py-1 text-[8px] font-mono uppercase tracking-[0.28em] text-cyan-200/55">{state === "idle" ? "READY" : state.toUpperCase()}</div>
    </div>
  );
};
