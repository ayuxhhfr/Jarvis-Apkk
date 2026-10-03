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
  isMemoryEnabled(): boolean;
  setMemoryEnabled(enabled: boolean): void;
  getConversationHistory(): any[];
  saveConversationHistory(messages: any[]): void;
  clearConversationHistory(): void;
}

// Common conversational stop words to ignore when scoring relevance
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

export class LocalStorageMemoryStore implements IMemoryStore {
  private memoryCache: MemoryItem[] | null = null;
  private memoryEnabledCache: boolean = true;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        this.memoryCache = [];
        return;
      }

      // Load memories
      const rawMemories = window.localStorage.getItem(MEMORY_STORAGE_KEY);
      if (rawMemories) {
        const parsed = JSON.parse(rawMemories);
        if (Array.isArray(parsed)) {
          this.memoryCache = parsed.filter(
            (m) => m && typeof m.content === "string" && m.content.trim().length > 0
          );
        } else {
          this.memoryCache = [];
        }
      } else {
        this.memoryCache = [];
      }

      // Load memory enabled setting
      const rawSettings = window.localStorage.getItem(MEMORY_SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings);
        if (typeof parsedSettings.enabled === "boolean") {
          this.memoryEnabledCache = parsedSettings.enabled;
        }
      }
    } catch (err) {
      console.warn("JARVIS MemoryStore: Failed to initialize from localStorage, using memory cache.", err);
      this.memoryCache = [];
    }
  }

  private persistToStorage(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage && this.memoryCache) {
        window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(this.memoryCache));
      }
    } catch (err) {
      console.warn("JARVIS MemoryStore: Failed to write to localStorage.", err);
    }
  }

  public async getAll(): Promise<MemoryItem[]> {
    if (this.memoryCache === null) {
      this.loadFromStorage();
    }
    return [...(this.memoryCache || [])];
  }

  public async getById(id: string): Promise<MemoryItem | null> {
    const all = await this.getAll();
    return all.find((m) => m.id === id) || null;
  }

  public async save(item: MemoryItem): Promise<void> {
    if (this.memoryCache === null) {
      this.loadFromStorage();
    }
    if (!this.memoryCache) {
      this.memoryCache = [];
    }

    const cleanContent = item.content.trim();
    if (!cleanContent) return;

    // Check if an existing memory has very similar content (case-insensitive deduplication)
    const existingIndex = this.memoryCache.findIndex(
      (m) => m.id === item.id || m.content.toLowerCase().trim() === cleanContent.toLowerCase()
    );

    const memoryToSave: MemoryItem = {
      ...item,
      content: cleanContent,
      updatedAt: new Date().toISOString(),
      active: item.active !== false,
    };

    if (existingIndex >= 0) {
      this.memoryCache[existingIndex] = {
        ...this.memoryCache[existingIndex],
        ...memoryToSave,
        id: this.memoryCache[existingIndex].id, // preserve existing ID
      };
    } else {
      this.memoryCache.unshift(memoryToSave);
    }

    this.persistToStorage();
  }

  public async saveBatch(items: MemoryItem[]): Promise<void> {
    for (const item of items) {
      await this.save(item);
    }
  }

  public async delete(id: string): Promise<boolean> {
    if (this.memoryCache === null) {
      this.loadFromStorage();
    }
    if (!this.memoryCache) return false;

    const initialLen = this.memoryCache.length;
    this.memoryCache = this.memoryCache.filter((m) => m.id !== id);
    const deleted = this.memoryCache.length < initialLen;
    if (deleted) {
      this.persistToStorage();
    }
    return deleted;
  }

  public async deleteByPattern(pattern: string): Promise<number> {
    if (this.memoryCache === null) {
      this.loadFromStorage();
    }
    if (!this.memoryCache || !pattern.trim()) return 0;

    const lowerPattern = pattern.toLowerCase().trim();
    const patternWords = lowerPattern
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

    const initialLen = this.memoryCache.length;
    this.memoryCache = this.memoryCache.filter((m) => {
      const lowerContent = m.content.toLowerCase();
      // Direct substring match
      if (lowerContent.includes(lowerPattern)) {
        return false;
      }
      // Keyword match if pattern has multiple meaningful words
      if (patternWords.length > 0) {
        const matchesWordCount = patternWords.filter((w) => lowerContent.includes(w)).length;
        if (matchesWordCount >= Math.min(2, patternWords.length)) {
          return false;
        }
      }
      return true;
    });

    const deletedCount = initialLen - this.memoryCache.length;
    if (deletedCount > 0) {
      this.persistToStorage();
    }
    return deletedCount;
  }

  public async clear(): Promise<void> {
    this.memoryCache = [];
    this.persistToStorage();
  }

  public async search(query: string, limit: number = 5): Promise<MemoryItem[]> {
    if (!this.isMemoryEnabled()) return [];

    const all = await this.getAll();
    if (all.length === 0) return [];

    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) return all.slice(0, limit);

    // Extract significant search tokens
    const tokens = trimmedQuery
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

    // Score each memory
    const scored = all.map((memory) => {
      const lowerContent = memory.content.toLowerCase();
      let score = 0;

      // Exact phrase match gives a massive boost
      if (lowerContent.includes(trimmedQuery)) {
        score += 20;
      }

      // Check each token
      for (const token of tokens) {
        if (lowerContent.includes(token)) {
          // Full word boundary match gets extra points
          const regex = new RegExp(`\\b${token}\\b`, "i");
          if (regex.test(lowerContent)) {
            score += 5;
          } else {
            score += 2;
          }
        }
        // Category match
        if (memory.category.toLowerCase().includes(token)) {
          score += 2;
        }
      }

      // Importance multiplier (1..5)
      const importanceWeight = Math.max(1, Math.min(5, memory.importance || 3));
      score = score * (1 + (importanceWeight - 1) * 0.15);

      return { memory, score };
    });

    // Filter out items with 0 score (irrelevant), sort by score desc
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  public async getFiltered(filter?: MemoryFilter): Promise<MemoryItem[]> {
    let list = await this.getAll();

    if (!filter) return list;

    if (filter.category) {
      list = list.filter((m) => m.category === filter.category);
    }

    if (filter.activeOnly) {
      list = list.filter((m) => m.active !== false);
    }

    if (filter.query) {
      const q = filter.query.toLowerCase();
      list = list.filter((m) => m.content.toLowerCase().includes(q));
    }

    if (filter.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  public isMemoryEnabled(): boolean {
    return this.memoryEnabledCache;
  }

  public setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabledCache = enabled;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(MEMORY_SETTINGS_KEY, JSON.stringify({ enabled }));
      }
    } catch (err) {
      console.warn("JARVIS MemoryStore: Failed to save memory settings.", err);
    }
  }

  public getConversationHistory(): any[] {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // Safe fallback
    }
    return [];
  }

  public saveConversationHistory(messages: any[]): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        // Keep up to latest 100 messages to prevent unbounded growth
        const trimmed = messages.slice(-100);
        window.localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(trimmed));
      }
    } catch (err) {
      console.warn("JARVIS MemoryStore: Failed to save conversation history.", err);
    }
  }

  public clearConversationHistory(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
      }
    } catch {
      // Safe fallback
    }
  }
}

export const defaultMemoryStore: IMemoryStore = new LocalStorageMemoryStore();
