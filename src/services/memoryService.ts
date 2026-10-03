/**
 * Long-Term Memory Service for JARVIS.
 * Modular, failure-safe memory pipeline with context retrieval, natural command parsing,
 * and seamless synchronization with Gemini Live and Chat sessions.
 */

import { MemoryItem, MemoryCategory, MemoryFilter } from "../types/memory";
import { defaultMemoryStore, IMemoryStore } from "./memoryStore";

export class MemoryService {
  private store: IMemoryStore;
  private listeners: Set<() => void> = new Set();

  constructor(customStore?: IMemoryStore) {
    this.store = customStore || defaultMemoryStore;
  }

  /**
   * Subscribe to memory updates (additions, deletions, edits).
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error("Error in memory change listener:", err);
      }
    });
  }

  /**
   * Check if the persistent memory system is enabled.
   */
  public isEnabled(): boolean {
    try {
      return this.store.isMemoryEnabled();
    } catch {
      return true;
    }
  }

  /**
   * Enable or disable persistent memory.
   */
  public setEnabled(enabled: boolean): void {
    try {
      this.store.setMemoryEnabled(enabled);
      this.notifyListeners();
    } catch (err) {
      console.warn("Failed to update memory enabled state:", err);
    }
  }

  /**
   * Infer an appropriate category from memory content if not specified.
   */
  public inferCategory(content: string): MemoryCategory {
    const lower = content.toLowerCase();

    if (
      lower.includes("prefer") ||
      lower.includes("like") ||
      lower.includes("favorite") ||
      lower.includes("theme") ||
      lower.includes("dark mode") ||
      lower.includes("light mode") ||
      lower.includes("short answer") ||
      lower.includes("concise")
    ) {
      return "preference";
    }

    if (
      lower.includes("project") ||
      lower.includes("building") ||
      lower.includes("app") ||
      lower.includes("repo") ||
      lower.includes("codebase") ||
      lower.includes("startup")
    ) {
      return "project";
    }

    if (
      lower.includes("typescript") ||
      lower.includes("javascript") ||
      lower.includes("python") ||
      lower.includes("react") ||
      lower.includes("node") ||
      lower.includes("sql") ||
      lower.includes("docker") ||
      lower.includes("rust") ||
      lower.includes("linux") ||
      lower.includes("framework")
    ) {
      return "technical";
    }

    if (
      lower.includes("always") ||
      lower.includes("never") ||
      lower.includes("rule") ||
      lower.includes("format") ||
      lower.includes("instruction")
    ) {
      return "instruction";
    }

    if (
      lower.includes("name is") ||
      lower.includes("live in") ||
      lower.includes("located in") ||
      lower.includes("birthday") ||
      lower.includes("email") ||
      lower.includes("phone")
    ) {
      return "personal";
    }

    return "other";
  }

  /**
   * Save a new long-term memory.
   */
  public async saveMemory(
    content: string,
    category?: MemoryCategory,
    importance: number = 3,
    source: "user_explicit" | "inferred" | "voice_command" | "manual" = "user_explicit"
  ): Promise<MemoryItem | null> {
    try {
      if (!this.isEnabled()) {
        console.log("Memory is currently disabled. Skipping save.");
        return null;
      }

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

      await this.store.save(memoryItem);
      this.notifyListeners();
      return memoryItem;
    } catch (err) {
      console.error("JARVIS MemoryService: Error saving memory:", err);
      return null;
    }
  }

  /**
   * Retrieve memories with optional filtering.
   */
  public async getMemories(filter?: MemoryFilter): Promise<MemoryItem[]> {
    try {
      if (!this.isEnabled()) return [];
      return await this.store.getFiltered(filter);
    } catch (err) {
      console.error("JARVIS MemoryService: Error retrieving memories:", err);
      return [];
    }
  }

  /**
   * Search memories relevant to a query.
   */
  public async searchMemories(query: string, limit: number = 5): Promise<MemoryItem[]> {
    try {
      if (!this.isEnabled()) return [];
      return await this.store.search(query, limit);
    } catch (err) {
      console.error("JARVIS MemoryService: Error searching memories:", err);
      return [];
    }
  }

  /**
   * Delete a memory by its unique ID.
   */
  public async deleteMemory(id: string): Promise<boolean> {
    try {
      const deleted = await this.store.delete(id);
      if (deleted) {
        this.notifyListeners();
      }
      return deleted;
    } catch (err) {
      console.error("JARVIS MemoryService: Error deleting memory:", err);
      return false;
    }
  }

  /**
   * Delete memories matching a pattern or key phrase (e.g. "my main project", "TypeScript").
   */
  public async deleteMemoryByPattern(pattern: string): Promise<number> {
    try {
      const count = await this.store.deleteByPattern(pattern);
      if (count > 0) {
        this.notifyListeners();
      }
      return count;
    } catch (err) {
      console.error("JARVIS MemoryService: Error deleting memory by pattern:", err);
      return 0;
    }
  }

  /**
   * Delete all stored long-term memories.
   */
  public async clearMemories(): Promise<void> {
    try {
      await this.store.clear();
      this.notifyListeners();
    } catch (err) {
      console.error("JARVIS MemoryService: Error clearing memories:", err);
    }
  }

  /**
   * Build targeted memory context string relevant to the current user query.
   * Returns empty string if no relevant memories or if memory is disabled.
   */
  public async getRelevantContext(query: string, maxItems: number = 4): Promise<string> {
    try {
      if (!this.isEnabled()) return "";

      const lower = query.toLowerCase();
      let relevant: MemoryItem[] = [];

      // 1. Detect project-continuation intents (e.g. "continue my project", "what's my project", "let's work on the app")
      if (
        lower.includes("continue") ||
        lower.includes("my project") ||
        lower.includes("our project") ||
        lower.includes("building") ||
        lower.includes("what was i working on") ||
        lower.includes("what are we building") ||
        lower.includes("project status") ||
        lower.includes("resume")
      ) {
        const projectMemories = await this.getMemories({ category: "project" });
        const techMemories = await this.getMemories({ category: "technical" });
        relevant = [...projectMemories, ...techMemories].slice(0, maxItems);
      }

      // 2. Detect identity/profile inquiries. These must use the personal-memory
      // bucket instead of keyword scoring because words like "who", "am", "I",
      // and "name" are commonly stop words and would otherwise score 0.
      if (
        relevant.length === 0 &&
        /^(who\s+am\s+i|what(?:'s|\s+is)\s+my\s+name|do\s+you\s+know\s+my\s+name|what\s+do\s+you\s+know\s+about\s+me)/i.test(lower.trim())
      ) {
        relevant = await this.getMemories({ category: "personal", activeOnly: true });
        if (relevant.length === 0) {
          relevant = (await this.getMemories({ activeOnly: true })).slice(0, maxItems);
        }
        relevant = relevant.slice(0, maxItems);
      }

      // 3. Detect preference or profile inquiries (e.g. "what voice do I use", "what are my preferences")
      if (relevant.length === 0 && (lower.includes("voice") || lower.includes("preference") || lower.includes("setting") || lower.includes("how do i like"))) {
        relevant = await this.getMemories({ category: "preference" });
      }

      // 4. Fallback to keyword relevance search
      if (relevant.length === 0) {
        relevant = await this.searchMemories(query, maxItems);
      }

      if (!relevant || relevant.length === 0) return "";

      const formatted = relevant
        .map((m) => `- ${m.content} [category: ${m.category}]`)
        .join("\n");

      return `\n\n[RELEVANT LONG-TERM MEMORIES FOR THE BOSS]:\n${formatted}\n(Incorporate this persistent knowledge naturally as your own memory of the Boss and their work. Do not cite "According to my memory database" unless specifically asked.)`;
    } catch (err) {
      console.warn("JARVIS MemoryService: Context retrieval error:", err);
      return "";
    }
  }

  /**
   * Build a compact persistent profile/context block for a fresh Live session.
   * This is intentionally small so a new session starts with durable memory
   * instead of relying on the previous Live session's hidden context.
   */
  public async getPersistentContext(maxItems: number = 8): Promise<string> {
    try {
      if (!this.isEnabled()) return "";
      const memories = await this.getMemories({ activeOnly: true });
      if (!memories.length) return "";

      const sorted = [...memories].sort((a, b) => {
        const importance = (b.importance || 3) - (a.importance || 3);
        if (importance !== 0) return importance;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }).slice(0, maxItems);

      const formatted = sorted.map((m) => `- ${m.content}`).join("\n");
      return `\n\n[PERSISTENT LONG-TERM MEMORY — SURVIVES NEW SESSIONS]:\n${formatted}\nTreat these as durable facts/preferences about the Boss. Use them naturally; do not mention the memory store unless asked.`;
    } catch (err) {
      console.warn("JARVIS MemoryService: Persistent context error:", err);
      return "";
    }
  }
  /**
   * Detect explicit natural language memory commands.
   * Handles:
   * - "Remember that I use TypeScript."
   * - "Remember my main project is JARVIS."
   * - "Forget that I use TypeScript."
   * - "What do you remember about me?"
   * - "Show my memories."
   * - "Delete all my memories."
   */
  public parseMemoryIntent(rawText: string): {
    type: "save" | "delete" | "query" | "clear";
    content?: string;
    category?: MemoryCategory;
    target?: string;
  } | null {
    const text = rawText.trim();
    const lower = text.toLowerCase();

    // Common Hinglish memory commands share the same persistent pipeline for JARVIS and Ira.
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

    // 1. Delete all memories / Clear memories
    if (
      /^(delete|clear|erase|wipe|remove)\s+(all\s+)?(my\s+)?memories/i.test(lower) ||
      /^clear\s+(my\s+)?memory/i.test(lower) ||
      lower === "delete all memories" ||
      lower === "clear all memories" ||
      lower === "forget everything"
    ) {
      return { type: "clear" };
    }

    // 2. Query / Show memories
    if (
      /^(what\s+do\s+you\s+remember\s+about\s+me|what\s+do\s+you\s+remember|show\s+(my\s+)?memories|list\s+(my\s+)?memories|view\s+(my\s+)?memories|tell\s+me\s+what\s+you\s+remember)/i.test(lower)
    ) {
      return { type: "query" };
    }

    // 3. Forget / Delete specific memory
    const forgetMatch = lower.match(
      /^(?:please\s+)?(?:forget|delete|remove|erase)(?:\s+that|\s+about|\s+memory\s+about)?\s+(.+)/i
    );
    if (forgetMatch) {
      let target = forgetMatch[1].trim();
      target = target.replace(/^(my|the|that|about)\s+/i, "");
      if (target) {
        return {
          type: "delete",
          target,
        };
      }
    }

    // 4. Remember explicit fact/preference
    const rememberMatch = text.match(
      /^(?:please\s+)?(?:remember\s+that|remember\s+to|remember\s+this:?|remember\s+my|remember\s+i|remember\s+the|remember)\s+(.+)/i
    );
    if (rememberMatch) {
      let rawFact = rememberMatch[1].trim();
      // Clean leading and trailing punctuation
      rawFact = rawFact.replace(/[.!?]+$/, "");

      // Format naturally for third-person or standard factual storage
      let cleanContent = rawFact;
      if (/^my\s+/i.test(cleanContent)) {
        cleanContent = "The user's " + cleanContent.slice(3);
      } else if (/^i\s+/i.test(cleanContent)) {
        cleanContent = "The user " + cleanContent.slice(2);
      } else if (!/^the\s+user/i.test(cleanContent)) {
        cleanContent = "The user: " + cleanContent;
      }

      const cat = this.inferCategory(rawFact);
      return {
        type: "save",
        content: cleanContent,
        category: cat,
      };
    }

    return null;
  }
}

export const memoryService = new MemoryService();
