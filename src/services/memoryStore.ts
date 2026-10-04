/**
 * Abstract Persistent Memory Storage Layer for JARVIS.
 * Provides resilient persistent storage using browser LocalStorage with in-memory fallback.
 * Designed with an abstract interface (IMemoryStore) so a backend database
 * (e.g., Firestore, PostgreSQL, Cloud SQL) can be plugged in seamlessly.
 */

import { MemoryItem, MemoryFilter, MemoryCategory } from "../types/memory";

const MEMORY_STORAGE_KEY = "jarvis_long_term_memories";
const MEMORY_SETTINGS_KEY = "jarvis_memory_settings";
const CONVERSATION_STORAGE_KEY = "jarvis_conversation_history";

export interface IMemoryStore {
  getAll(): Promise<MemoryItem[]>;
  getById(id: string): Promise<MemoryItem | null>;
  save(item: MemoryItem): Promise<void>;
  saveBatch(items: MemoryItem[]): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteByPattern(pattern: string): Promise<number>;
  clear(): Promise<void>;
  search(query: string, limit?: number): Promise<MemoryItem[]>;
  getFiltered(filter?: MemoryFilter): Promise<MemoryItem[]>;
  /** Re-read persisted state (e.g. after another tab/window wrote to storage). */
  reload?(): void;
  isMemoryEnabled(): boolean;
  setMemoryEnabled(enabled: boolean): void;
  getConversationHistory(): any[];
  saveConversationHistory(messages: any[]): void;
  clearConversationHistory(): void;
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "cannot", "could", "did", "do",
  "does", "doing", "don't", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers",
  "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "itself", "let", "me", "more", "most", "my", "myself", "no", "nor",
  "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so",
  "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "wasn't", "we", "were", "what",
  "when", "where", "which", "while", "who", "whom", "why", "with", "would",
  "you", "your", "yours", "yourself", "yourselves", "tell", "show", "know"
]);

export function normalizeMemoryKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
}

export const MEMORY_STORAGE_KEY_NAME = MEMORY_STORAGE_KEY;

export class LocalStorageMemoryStore implements IMemoryStore {
  private memoryCache: MemoryItem[] | null = null;
  private memoryEnabledCache = true;

  constructor() { this.loadFromStorage(); }

  private loadFromStorage(): void {
    try {
      if (typeof window === "undefined" || !window.localStorage) { this.memoryCache = []; return; }
      const rawMemories = window.localStorage.getItem(MEMORY_STORAGE_KEY);
      if (rawMemories) {
        const parsed = JSON.parse(rawMemories);
        this.memoryCache = Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0) : [];
      } else this.memoryCache = [];
      const rawSettings = window.localStorage.getItem(MEMORY_SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings);
        if (typeof parsedSettings.enabled === "boolean") this.memoryEnabledCache = parsedSettings.enabled;
      }
    } catch (err) {
      console.warn("JARVIS MemoryStore: Failed to initialize from localStorage, using memory cache.", err);
      this.memoryCache = [];
    }
  }

  public reload(): void { this.loadFromStorage(); }

  private persistToStorage(): void {
    if (typeof window === "undefined" || !window.localStorage || !this.memoryCache) {
      throw new Error("Persistent memory storage is unavailable in this runtime.");
    }
    try {
      window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(this.memoryCache));
    } catch (err) {
      console.error("JARVIS MemoryStore: Failed to persist long-term memory.", err);
      throw new Error("Long-term memory could not be persisted to localStorage.");
    }
  }

  public async getAll(): Promise<MemoryItem[]> {
    if (this.memoryCache === null) this.loadFromStorage();
    return [...(this.memoryCache || [])];
  }

  public async getById(id: string): Promise<MemoryItem | null> {
    return (await this.getAll()).find((m) => m.id === id) || null;
  }

  public async save(item: MemoryItem): Promise<void> {
    if (this.memoryCache === null) this.loadFromStorage();
    if (!this.memoryCache) this.memoryCache = [];
    const cleanContent = item.content.trim();
    if (!cleanContent) return;
    const key = normalizeMemoryKey(cleanContent);
    const existingIndex = this.memoryCache.findIndex((m) => m.id === item.id || normalizeMemoryKey(m.content) === key);
    const memoryToSave: MemoryItem = { ...item, content: cleanContent, updatedAt: new Date().toISOString(), active: item.active !== false };
    const previousCache = this.memoryCache;
    const nextCache = [...previousCache];
    if (existingIndex >= 0) {
      const prev = nextCache[existingIndex];
      nextCache[existingIndex] = { ...prev, ...memoryToSave, id: prev.id, content: prev.content, createdAt: prev.createdAt || memoryToSave.createdAt, importance: Math.max(prev.importance || 1, memoryToSave.importance || 1), category: memoryToSave.category === "other" ? prev.category : memoryToSave.category };
    } else nextCache.unshift(memoryToSave);
    this.memoryCache = nextCache;
    try { this.persistToStorage(); } catch (err) { this.memoryCache = previousCache; throw err; }
  }

  public async saveBatch(items: MemoryItem[]): Promise<void> {
    if (this.memoryCache === null) this.loadFromStorage();
    if (!this.memoryCache) this.memoryCache = [];
    const previousCache = this.memoryCache;
    let nextCache = [...previousCache];
    try {
      for (const item of items) {
        const cleanContent = item.content.trim();
        if (!cleanContent) continue;
        const key = normalizeMemoryKey(cleanContent);
        const existingIndex = nextCache.findIndex((m) => m.id === item.id || normalizeMemoryKey(m.content) === key);
        const memoryToSave: MemoryItem = { ...item, content: cleanContent, updatedAt: new Date().toISOString(), active: item.active !== false };
        if (existingIndex >= 0) {
          const prev = nextCache[existingIndex];
          nextCache[existingIndex] = { ...prev, ...memoryToSave, id: prev.id, content: prev.content, createdAt: prev.createdAt || memoryToSave.createdAt, importance: Math.max(prev.importance || 1, memoryToSave.importance || 1), category: memoryToSave.category === "other" ? prev.category : memoryToSave.category };
        } else nextCache.unshift(memoryToSave);
      }
      this.memoryCache = nextCache;
      this.persistToStorage();
    } catch (err) { this.memoryCache = previousCache; throw err; }
  }

  public async delete(id: string): Promise<boolean> {
    if (this.memoryCache === null) this.loadFromStorage();
    if (!this.memoryCache) return false;
    const previousCache = this.memoryCache;
    const nextCache = previousCache.filter((m) => m.id !== id);
    const deleted = nextCache.length < previousCache.length;
    if (!deleted) return false;
    this.memoryCache = nextCache;
    try { this.persistToStorage(); return true; } catch (err) { this.memoryCache = previousCache; throw err; }
  }

  public async deleteByPattern(pattern: string): Promise<number> {
    if (this.memoryCache === null) this.loadFromStorage();
    if (!this.memoryCache || !pattern.trim()) return 0;
    const lowerPattern = pattern.toLowerCase().trim();
    const patternWords = lowerPattern.replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    const previousCache = this.memoryCache;
    const nextCache = previousCache.filter((m) => {
      const lowerContent = m.content.toLowerCase();
      if (lowerContent.includes(lowerPattern)) return false;
      if (patternWords.length > 0) {
        const matchesWordCount = patternWords.filter((w) => lowerContent.includes(w)).length;
        if (matchesWordCount >= Math.min(2, patternWords.length)) return false;
      }
      return true;
    });
    const deletedCount = previousCache.length - nextCache.length;
    if (deletedCount === 0) return 0;
    this.memoryCache = nextCache;
    try { this.persistToStorage(); return deletedCount; } catch (err) { this.memoryCache = previousCache; throw err; }
  }

  public async clear(): Promise<void> {
    const previousCache = this.memoryCache === null ? [] : this.memoryCache;
    this.memoryCache = [];
    try { this.persistToStorage(); } catch (err) { this.memoryCache = previousCache; throw err; }
  }

  public async search(query: string, limit = 5): Promise<MemoryItem[]> {
    if (!this.isMemoryEnabled()) return [];
    const all = await this.getAll();
    if (all.length === 0) return [];
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return all.slice(0, limit);
    const tokens = trimmedQuery.replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    const scored = all.map((memory) => {
      const lowerContent = memory.content.toLowerCase();
      let score = 0;
      if (lowerContent.includes(trimmedQuery)) score += 20;
      for (const token of tokens) {
        if (lowerContent.includes(token)) {
          const regex = new RegExp(`\\b${token}\\b`, "i");
          score += regex.test(lowerContent) ? 5 : 2;
        }
        if (memory.category.toLowerCase().includes(token)) score += 2;
      }
      const importanceWeight = Math.max(1, Math.min(5, memory.importance || 3));
      score *= 1 + (importanceWeight - 1) * 0.15;
      return { memory, score };
    });
    return scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.memory);
  }

  public async getFiltered(filter?: MemoryFilter): Promise<MemoryItem[]> {
    let list = await this.getAll();
    if (!filter) return list;
    if (filter.category) list = list.filter((m) => m.category === filter.category);
    if (filter.activeOnly) list = list.filter((m) => m.active !== false);
    if (filter.query) list = list.filter((m) => m.content.toLowerCase().includes(filter.query!.toLowerCase()));
    if (filter.limit && filter.limit > 0) list = list.slice(0, filter.limit);
    return list;
  }

  public isMemoryEnabled(): boolean { return this.memoryEnabledCache; }

  public setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabledCache = enabled;
    try {
      if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify({ enabled }));
    } catch (err) { console.warn("JARVIS MemoryStore: Failed to save memory settings.", err); }
  }

  public getConversationHistory(): any[] {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
      if (raw) { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    } catch {}
    return [];
  }

  public saveConversationHistory(messages: any[]): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(messages.slice(-100)));
    } catch (err) { console.warn("JARVIS MemoryStore: Failed to save conversation history.", err); }
  }

  public clearConversationHistory(): void {
    try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.removeItem(CONVERSATION_STORAGE_KEY); } catch {}
  }
}

export const defaultMemoryStore: IMemoryStore = new LocalStorageMemoryStore();
