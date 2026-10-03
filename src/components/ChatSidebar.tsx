import React, { useEffect, useMemo, useState } from "react";
import { MessageSquare, Plus, X } from "lucide-react";
import { ChatMessage } from "../types/message";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const KEY = "jarvis_chat_sessions_v2";

const makeTitle = (messages: ChatMessage[]) => {
  const first = messages.find(m => m.role === "user" && (m.content || m.text));
  const value = (first?.content || first?.text || "New conversation").trim();
  return value.length > 34 ? value.slice(0, 34) + "…" : value;
};

export const ChatSidebar: React.FC<{
  messages: ChatMessage[];
  activeId: string;
  onSelect: (session: ChatSession) => void;
  onNew: () => void;
  onClose: () => void;
}> = ({ messages, activeId, onSelect, onNew, onClose }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSessions(Array.isArray(parsed) ? parsed : []);
    } catch { setSessions([]); }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const next: ChatSession = {
      id: activeId,
      title: makeTitle(messages),
      messages,
      updatedAt: Date.now(),
    };
    setSessions(prev => {
      const exists = prev.some(s => s.id === activeId);
      const merged = exists ? prev.map(s => s.id === activeId ? next : s) : [next, ...prev];
      const trimmed = merged.sort((a,b) => b.updatedAt - a.updatedAt).slice(0, 50);
      try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch {}
      return trimmed;
    });
  }, [messages, activeId]);

  const visible = useMemo(() => sessions.filter(s => s.id !== activeId || s.messages.length > 0), [sessions, activeId]);

  return (
    <aside className="fixed inset-y-0 left-0 z-[70] w-[min(88vw,320px)] bg-[#090b0e]/98 backdrop-blur-xl border-r border-white/[0.08] flex flex-col shadow-2xl">
      <div className="jarvis-safe-top flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#00ffaa]" />
          <span className="font-mono text-xs tracking-[0.2em] text-white uppercase">Conversations</span>
        </div>
        <button onClick={onClose} className="p-2 text-neutral-400 hover:text-white cursor-pointer" aria-label="Close chats"><X className="w-4 h-4" /></button>
      </div>
      <button onClick={onNew} className="mx-3 mt-3 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 bg-[#00ffaa] text-black text-xs font-semibold cursor-pointer active:scale-[.98]">
        <Plus className="w-4 h-4" /> New chat
      </button>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {visible.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-neutral-500">No previous conversations yet.</div>
        ) : visible.map(session => (
          <button key={session.id} onClick={() => onSelect(session)} className={`w-full text-left px-3 py-3 rounded-xl border transition-colors cursor-pointer ${session.id === activeId ? "bg-white/[0.07] border-[#00ffaa]/25" : "border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]"}`}>
            <div className="text-xs text-neutral-200 truncate">{session.title}</div>
            <div className="mt-1 text-[10px] text-neutral-500 font-mono">{session.messages.length} messages</div>
          </button>
        ))}
      </div>
    </aside>
  );
};