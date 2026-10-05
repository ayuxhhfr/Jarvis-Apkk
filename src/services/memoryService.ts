/**
 * Long-Term Memory Service for JARVIS.
 * Modular, failure-safe memory pipeline with context retrieval, natural command parsing,
 * and seamless synchronization with Gemini Live and Chat sessions.
 */

import { MemoryItem, MemoryCategory, MemoryFilter } from "../types/memory";
import { defaultMemoryStore, IMemoryStore, MEMORY_STORAGE_KEY_NAME } from "./memoryStore";

export class MemoryService {
  private store: IMemoryStore;
  private listeners: Set<() => void> = new Set();

  constructor(customStore?: IMemoryStore) {
    this.store = customStore || defaultMemoryStore;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("storage", (e: StorageEvent) => {
        if (e.key === null || e.key === MEMORY_STORAGE_KEY_NAME) {
          try { this.store.reload?.(); } catch {}
          this.notifyListeners();
        }
      });
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try { listener(); } catch (err) { console.error("Error in memory change listener:", err); }
    });
  }

  public isEnabled(): boolean {
    try { return this.store.isMemoryEnabled(); } catch { return true; }
  }

  public setEnabled(enabled: boolean): void {
    try { this.store.setMemoryEnabled(enabled); this.notifyListeners(); }
    catch (err) { console.warn("Failed to update memory enabled state:", err); }
  }

  public inferCategory(content: string): MemoryCategory {
    const lower = content.toLowerCase();
    if (lower.includes("prefer") || lower.includes("like") || lower.includes("favorite") || lower.includes("theme") || lower.includes("dark mode") || lower.includes("light mode") || lower.includes("short answer") || lower.includes("concise")) return "preference";
    if (lower.includes("project") || lower.includes("building") || lower.includes("app") || lower.includes("repo") || lower.includes("codebase") || lower.includes("startup")) return "project";
    if (lower.includes("typescript") || lower.includes("javascript") || lower.includes("python") || lower.includes("react") || lower.includes("node") || lower.includes("sql") || lower.includes("docker") || lower.includes("rust") || lower.includes("linux") || lower.includes("framework")) return "technical";
    if (lower.includes("always") || lower.includes("never") || lower.includes("rule") || lower.includes("format") || lower.includes("instruction")) return "instruction";
    if (lower.includes("name is") || lower.includes("live in") || lower.includes("located in") || lower.includes("birthday") || lower.includes("email") || lower.includes("phone")) return "personal";
    return "other";
  }

  public async saveMemory(content: string, category?: MemoryCategory, importance = 3, source: "user_explicit" | "inferred" | "voice_command" | "manual" = "user_explicit"): Promise<MemoryItem | null> {
    if (!this.isEnabled()) return null;
    const trimmedContent = content.trim();
    if (!trimmedContent) return null;
    const inferredCat = category || this.inferCategory(trimmedContent);
    const now = new Date().toISOString();
    const memoryItem: MemoryItem = {
      id: "mem_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      content: trimmedContent,
      category: inferredCat,
      importance: Math.min(5, Math.max(1, importance)),
      createdAt: now,
      updatedAt: now,
      source,
      active: true,
    };
    try {
      await this.store.save(memoryItem);
      this.notifyListeners();
      return memoryItem;
    } catch (err) {
      console.error("JARVIS MemoryService: Error saving memory:", err);
      throw err;
    }
  }

  public async getMemories(filter?: MemoryFilter): Promise<MemoryItem[]> {
    try {
      if (!this.isEnabled()) return [];
      return await this.store.getFiltered(filter);
    } catch (err) { console.error("JARVIS MemoryService: Error retrieving memories:", err); return []; }
  }

  public async searchMemories(query: string, limit = 5): Promise<MemoryItem[]> {
    try {
      if (!this.isEnabled()) return [];
      return await this.store.search(query, limit);
    } catch (err) { console.error("JARVIS MemoryService: Error searching memories:", err); return []; }
  }

  public async deleteMemory(id: string): Promise<boolean> {
    try {
      const deleted = await this.store.delete(id);
      if (deleted) this.notifyListeners();
      return deleted;
    } catch (err) { console.error("JARVIS MemoryService: Error deleting memory:", err); throw err; }
  }

  public async deleteMemoryByPattern(pattern: string): Promise<number> {
    try {
      const count = await this.store.deleteByPattern(pattern);
      if (count > 0) this.notifyListeners();
      return count;
    } catch (err) { console.error("JARVIS MemoryService: Error deleting memory by pattern:", err); throw err; }
  }

  public async clearMemories(): Promise<boolean> {
    try { await this.store.clear(); this.notifyListeners(); return true; }
    catch (err) { console.error("JARVIS MemoryService: Error clearing memories:", err); return false; }
  }

  /**
   * Context for the manager model. Language-agnostic on purpose: instead of gating on
   * English keywords, the model gets the user's memories and decides what is relevant.
   * Small stores are sent whole; larger ones are ranked (keyword match first, then importance).
   */
  public async getRelevantContext(query: string, maxItems = 20): Promise<string> {
    try {
      if (!this.isEnabled()) return "";
      const all = await this.getMemories({ activeOnly: true });
      if (!all.length) return "";

      const byImportance = [...all].sort((a, b) => {
        const imp = (b.importance || 3) - (a.importance || 3);
        if (imp !== 0) return imp;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      let selected: MemoryItem[];
      if (all.length <= maxItems) {
        selected = byImportance;
      } else {
        const matched = await this.searchMemories(query, 6);
        const seen = new Set(matched.map((m) => m.id));
        selected = [...matched, ...byImportance.filter((m) => !seen.has(m.id))].slice(0, maxItems);
      }

      const formatted = selected.map((m) => `- ${m.content} [${m.category}]`).join("\n");
      return `\n\n[LONG-TERM MEMORY ABOUT THE BOSS]:\n${formatted}\n(These are durable facts about the Boss, saved from earlier conversations. Use them naturally whenever relevant, in whatever language the Boss speaks. If asked who they are, what their name is, or what you remember, answer from this list. Do not mention a memory database unless asked.)`;
    } catch (err) { console.warn("JARVIS MemoryService: Context retrieval error:", err); return ""; }
  }

  public async getPersistentContext(maxItems = 12): Promise<string> {
    try {
      if (!this.isEnabled()) return "";
      const memories = await this.getMemories({ activeOnly: true });
      if (!memories.length) return "";
      const sorted = [...memories].sort((a,b) => {
        const importance = (b.importance || 3) - (a.importance || 3);
        if (importance !== 0) return importance;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }).slice(0, maxItems);
      const formatted = sorted.map((m) => `- ${m.content}`).join("\n");
      return `\n\n[PERSISTENT LONG-TERM MEMORY — SURVIVES NEW SESSIONS]:\n${formatted}\nTreat these as durable facts/preferences about the Boss. Use them naturally; do not mention the memory store unless asked.`;
    } catch (err) { console.warn("JARVIS MemoryService: Persistent context error:", err); return ""; }
  }

  /**
   * Instant, offline extraction of clear identity statements. Covers English, Hinglish and
   * Hindi script. Deliberately conservative: anything ambiguous is left to the AI classifier.
   */
  public extractQuickFacts(rawText: string): Array<{ content: string; category: MemoryCategory; importance: number }> {
    const text = rawText.trim().replace(/[.!?।]+$/u, "").trim();
    if (!text || text.length > 120) return [];

    const notName = new Set([
      "a","an","the","not","so","very","just","really","also","still","now","here","there","going","gonna","wanna",
      "trying","working","looking","from","in","at","on","with","about","into","too","done","back","home","online",
      "free","late","early","new","good","bad","great","fine","ok","okay","sure","sorry","glad","happy","sad","angry",
      "tired","sleepy","hungry","thirsty","bored","busy","ready","confused","excited","scared","sick","afraid","fan",
      "student","here","coming","leaving","waiting","thinking","hi","hello","hey","yes","no","never","always","ab","abhi",
      "bahut","bohot","thoda","kal","aaj","theek","thik","accha","achha","mast","free","kuch","kya","kaise"
    ]);
    const cleanName = (raw: string, maxWords: number): string | null => {
      const words = raw.trim().split(/\s+/);
      if (!words.length || words.length > maxWords) return null;
      const first = words[0].toLowerCase();
      if (notName.has(first) || /ing$/i.test(first)) return null;
      if (!words.every((w) => /^[\p{L}\p{M}][\p{L}\p{M}'\-.]{0,24}$/u.test(w))) return null;
      return words.map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
    };

    const facts: Array<{ content: string; category: MemoryCategory; importance: number }> = [];
    const push = (name: string | null) => {
      if (name) facts.push({ content: `The user's name is ${name}`, category: "personal", importance: 5 });
    };

    let m: RegExpMatchArray | null;
    // Explicit name statements (English / Hinglish / Hindi) — accept up to 3 words.
    if ((m = text.match(/\b(?:my\s+name\s+is|call\s+me|name['’]s)\s+(.+)$/i))) push(cleanName(m[1], 3));
    else if ((m = text.match(/\bmera\s+(?:naam|name)\s+(.+?)\s+(?:hai|h|he)$/i))) push(cleanName(m[1], 3));
    else if ((m = text.match(/\bmujhe\s+(.+?)\s+(?:bulao|bulana|bolo|bolna|kaho)$/i))) push(cleanName(m[1], 2));
    else if ((m = text.match(/(?:मेरा\s+नाम|मेरा\s+नेम)\s+(.+?)\s+(?:है|हैं)$/u))) push(cleanName(m[1], 3));
    else if ((m = text.match(/^(?:मैं|में|मै)\s+(.+?)\s+(?:हूँ|हूं|हु)$/u))) push(cleanName(m[1], 2));
    // Whole-utterance short forms: "I'm Void", "I am Void", "im Void", "main Void hu".
    else if ((m = text.match(/^(?:i['’]?m|i\s+am)\s+(.+)$/i))) push(cleanName(m[1], 2));
    else if ((m = text.match(/^(?:main|mai|mein)\s+(.+?)\s+(?:hu|hoon|hun|hoo)$/i))) push(cleanName(m[1], 2));

    return facts;
  }

  public parseMemoryIntent(rawText: string): { type: "save" | "delete" | "query" | "clear"; content?: string; category?: MemoryCategory; target?: string } | null {
    const text = rawText.trim();
    const lower = text.toLowerCase();

    if (/^(?:yaad\s+rakh|yaad\s+rakhna|remember)\b/i.test(lower)) {
      const fact = text.replace(/^(?:yaad\s+rakh(?:na)?|remember)(?:\s+ki|\s+that)?\s*/i, "").trim().replace(/[.!?]+$/, "");
      if (fact) {
        let cleanContent = fact;
        if (/^mera\s+/i.test(cleanContent)) cleanContent = "The user's " + cleanContent.slice(5);
        else if (/^meri\s+/i.test(cleanContent)) cleanContent = "The user's " + cleanContent.slice(5);
        else if (/^main\s+/i.test(cleanContent)) cleanContent = "The user " + cleanContent.slice(5);
        else if (!/^the\s+user/i.test(cleanContent)) cleanContent = "The user: " + cleanContent;
        return { type: "save", content: cleanContent, category: this.inferCategory(fact) };
      }
    }
    if (/^(?:kya\s+yaad\s+hai|meri\s+memory|memory\s+dikha|yaadein\s+dikha)/i.test(lower)) return { type: "query" };
    if (/^(?:sab\s+bhool|meri\s+saari\s+memory\s+(?:delete|clear)|memory\s+clear)/i.test(lower)) return { type: "clear" };
    if (/^(?:ye\s+bhool|isko\s+bhool|bhool\s+jao|forget\s+this)\b/i.test(lower)) {
      const target = text.replace(/^(?:ye\s+bhool|isko\s+bhool|bhool\s+jao|forget\s+this)\s*/i, "").trim();
      if (target) return { type: "delete", target };
    }
    if (/^(delete|clear|erase|wipe|remove)\s+(all\s+)?(my\s+)?memories/i.test(lower) || /^clear\s+(my\s+)?memory/i.test(lower) || lower === "delete all memories" || lower === "clear all memories" || lower === "forget everything") return { type: "clear" };
    if (/^(what\s+do\s+you\s+remember\s+about\s+me|what\s+do\s+you\s+remember|show\s+(my\s+)?memories|list\s+(my\s+)?memories|view\s+(my\s+)?memories|tell\s+me\s+what\s+you\s+remember)/i.test(lower)) return { type: "query" };
    const forgetMatch = lower.match(/^(?:please\s+)?(?:forget|delete|remove|erase)(?:\s+that|\s+about|\s+memory\s+about)?\s+(.+)/i);
    if (forgetMatch) {
      const target = forgetMatch[1].trim().replace(/^(my|the|that|about)\s+/i, "");
      if (target) return { type: "delete", target };
    }
    const rememberMatch = text.match(/^(?:please\s+)?(?:remember\s+that|remember\s+to|remember\s+this:?|remember\s+my|remember\s+i|remember\s+the|remember)\s+(.+)/i);
    if (rememberMatch) {
      let rawFact = rememberMatch[1].trim().replace(/[.!?]+$/, "");
      let cleanContent = rawFact;
      if (/^my\s+/i.test(cleanContent)) cleanContent = "The user's " + cleanContent.slice(3);
      else if (/^i\s+/i.test(cleanContent)) cleanContent = "The user " + cleanContent.slice(2);
      else if (!/^the\s+user/i.test(cleanContent)) cleanContent = "The user: " + cleanContent;
      return { type: "save", content: cleanContent, category: this.inferCategory(rawFact) };
    }
    return null;
  }
}

export const memoryService = new MemoryService();