import React, { useCallback, useEffect, useState } from "react";
import { Brain, X, Trash2, Plus, ChevronRight } from "lucide-react";
import { memoryService } from "../services/memoryService";
import { MemoryItem } from "../types/memory";

interface MemoryDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

const categories = ["personal", "preference", "project", "instruction", "routine", "technical", "other"] as const;

export const MemoryDashboard: React.FC<MemoryDashboardProps> = ({ isOpen, onClose }) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [isAdding, setIsAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryItem["category"]>("personal");
  const [clearConfirming, setClearConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemories(await memoryService.getMemories());
    } catch {
      setMemories([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void load();
    return memoryService.subscribe(() => { void load(); });
  }, [isOpen, load]);

  if (!isOpen) return null;

  const filtered = activeCategory === "all"
    ? memories
    : memories.filter((m) => m.category === activeCategory);

  const addMemory = async () => {
    const text = newText.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await memoryService.saveMemory(text, newCategory, 3, "manual");
      setNewText("");
      setIsAdding(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    await memoryService.clearMemories();
    setClearConfirming(false);
    await load();
  };

  return (
    <div className="fixed inset-0 z-[80] pointer-events-auto">
      <button
        aria-label="Close memory dashboard"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
      />

      <aside
        className="absolute right-0 top-0 h-full w-full sm:w-[min(92vw,460px)] bg-[#05080b]/[0.98] border-l border-white/[0.10] shadow-[-25px_0_70px_rgba(0,0,0,0.55)] flex flex-col"
        style={{
          paddingTop: "max(18px, env(safe-area-inset-top))",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl border border-[#00ffaa]/20 bg-[#00ffaa]/[0.06] flex items-center justify-center">
              <Brain className="w-5 h-5 text-[#00ffaa]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-[0.14em] uppercase font-mono text-white">
                Memory Core
              </h2>
              <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
                Persistent recollections · {memories.length}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.06]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory("all")}
            className={`shrink-0 px-3 py-1.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${activeCategory === "all" ? "bg-white text-black border-white" : "bg-white/[0.03] border-white/[0.08] text-neutral-400"}`}
          >All</button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`shrink-0 px-3 py-1.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${activeCategory === category ? "bg-[#00ffaa]/10 text-[#00ffaa] border-[#00ffaa]/30" : "bg-white/[0.03] border-white/[0.08] text-neutral-400"}`}
            >{category}</button>
          ))}
        </div>

        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-[10px] text-neutral-500 font-mono">
            JARVIS learns durable facts from conversations.
          </span>
          <button
            onClick={() => setIsAdding((v) => !v)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#00ffaa]/20 bg-[#00ffaa]/[0.05] text-[10px] font-mono text-[#00ffaa]"
          >
            <Plus className="w-3 h-3" /> ADD
          </button>
        </div>

        {isAdding && (
          <div className="px-5 py-4 border-b border-white/[0.07] bg-white/[0.02] space-y-3">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as MemoryItem["category"])}
              className="w-full rounded-xl bg-[#0b1015] border border-white/[0.08] px-3 py-2.5 text-xs text-white outline-none"
            >
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="What should JARVIS remember?"
              rows={3}
              className="w-full resize-none rounded-xl bg-[#0b1015] border border-white/[0.08] px-3 py-2.5 text-xs text-white placeholder:text-neutral-600 outline-none focus:border-[#00ffaa]/40"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsAdding(false)} className="px-3 py-2 rounded-lg text-xs text-neutral-400">Cancel</button>
              <button disabled={!newText.trim() || saving} onClick={() => void addMemory()} className="px-3 py-2 rounded-lg bg-[#00ffaa] text-black text-xs font-semibold disabled:opacity-40">
                {saving ? "Saving..." : "Save Memory"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-600">
              <Brain className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-xs font-mono">No memories in this category.</p>
            </div>
          ) : filtered.map((memory) => (
            <div key={memory.id} className="group rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
              <div className="flex items-start gap-3">
                <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-[#00ffaa]/50 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-5 text-neutral-200 break-words">{memory.content}</p>
                  <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-neutral-600 uppercase">
                    <span>{memory.category}</span>
                    <span>·</span>
                    <span>importance {memory.importance}</span>
                  </div>
                </div>
                <button
                  onClick={async () => { await memoryService.deleteMemory(memory.id); await load(); }}
                  className="opacity-50 sm:opacity-0 group-hover:opacity-100 p-1.5 text-neutral-500 hover:text-rose-400 transition"
                  aria-label="Delete memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.07]">
          {!clearConfirming ? (
            <button
              onClick={() => setClearConfirming(true)}
              disabled={!memories.length}
              className="flex items-center gap-2 text-[10px] font-mono text-rose-400 disabled:opacity-30"
            >
              <Trash2 className="w-3 h-3" /> CLEAR ALL MEMORIES
            </button>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-mono text-rose-300">Clear every saved memory?</span>
              <div className="flex gap-2">
                <button onClick={() => setClearConfirming(false)} className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] text-[10px] text-neutral-300">Cancel</button>
                <button onClick={() => void clearAll()} className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-[10px] text-rose-300">Clear</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
