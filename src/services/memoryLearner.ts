/**
 * Memory Learner for JARVIS.
 *
 * Makes long-term memory resilient to model outages:
 *  1. Instant, rule-based save of clear identity facts ("I'm Void", "mera naam Void hai").
 *     This never touches the network, so it works even when every Gemini model is busy.
 *  2. AI classification (lite model) in the background for everything else.
 *  3. If the classifier is unavailable, the message is stored in a persistent retry
 *     queue (localStorage) and retried later, so nothing durable is lost.
 */

import { memoryService } from "./memoryService";
import { geminiText } from "./geminiText";

type LearnSource = "voice_command" | "inferred";

interface PendingItem {
  text: string;
  source: LearnSource;
  tries: number;
  at: number;
}

const QUEUE_KEY = "jarvis_memory_pending_v1";
const MAX_QUEUE = 30;
const MAX_TRIES = 8;

function readQueue(): PendingItem[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((p) => p && typeof p.text === "string" && p.text.trim())
      : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingItem[]): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    // Ignore quota/private-mode errors; queue is best-effort.
  }
}

class MemoryLearner {
  private draining = false;

  private getBackgroundModel(): string {
    try {
      const raw = window.localStorage.getItem("jarvis_assistant_settings");
      const settings = raw ? JSON.parse(raw) : {};
      return typeof settings?.backgroundModel === "string" ? settings.backgroundModel : "auto";
    } catch {
      return "auto";
    }
  }

  /**
   * Learn from a user utterance.
   * Resolves as soon as the instant (rule-based) saves are done, so the very next
   * context lookup already contains them. The AI classification continues in the background.
   */
  public async learn(text: string, source: LearnSource): Promise<void> {
    const clean = (text || "").trim();
    if (clean.length < 3) return;
    if (!memoryService.isEnabled()) return;

    // Explicit remember/forget commands are deterministic and are handled by
    // the explicit command path. Implicit learning has exactly one authority:
    // Gemini 2.5 Flash-Lite, after the caller has provided a complete utterance.
    if (memoryService.parseMemoryIntent(clean)) return;

    try {
      const existing = (await memoryService.getMemories({ activeOnly: true }))
        .slice(0, 40)
        .map((m) => m.content);
      const decision = await geminiText.classifyMemoryCandidate(clean, existing);

      if (decision.failed) {
        this.enqueue(clean, source);
        return;
      }

      if (decision.shouldRemember) {
        await this.saveAll(decision.memories, source);
      }

      void this.drain();
    } catch (err) {
      console.warn("[MemoryLearner] AI learning error:", err);
      this.enqueue(clean, source);
    }
  }

  private async learnWithAI(text: string, source: LearnSource, quickSaved: number): Promise<void> {
    try {
      const existing = (await memoryService.getMemories({ activeOnly: true }))
        .slice(0, 40)
        .map((m) => m.content);
      const decision = await geminiText.classifyMemoryCandidate(text, existing);

      if (decision.failed) {
        // A short, fully handled identity sentence does not need another attempt.
        const words = text.split(/\s+/).length;
        if (!(quickSaved > 0 && words <= 6)) this.enqueue(text, source);
        return;
      }

      if (decision.shouldRemember) {
        await this.saveAll(decision.memories, source);
      }

      // Service is reachable again: flush anything that was waiting.
      void this.drain();
    } catch (err) {
      console.warn("[MemoryLearner] AI learning error:", err);
      this.enqueue(text, source);
    }
  }

  private async saveAll(
    memories: Array<{ content: string; category: any; importance: number }>,
    source: LearnSource
  ): Promise<void> {
    for (const m of memories) {
      try {
        await memoryService.saveMemory(
          m.content,
          m.category,
          Math.min(5, Math.max(1, Number(m.importance) || 3)),
          source
        );
      } catch (err) {
        console.warn("[MemoryLearner] Save failed:", err);
      }
    }
  }

  private enqueue(text: string, source: LearnSource): void {
    const queue = readQueue();
    if (queue.some((q) => q.text === text)) return;
    queue.push({ text, source, tries: 0, at: Date.now() });
    writeQueue(queue);
  }

  /** Retry queued messages. Safe to call often; stops at the first failure (service still down). */
  public async drain(): Promise<void> {
    if (this.draining) return;
    if (!memoryService.isEnabled()) return;
    this.draining = true;
    try {
      let queue = readQueue();
      while (queue.length) {
        const item = queue[0];
        const existing = (await memoryService.getMemories({ activeOnly: true }))
          .slice(0, 40)
          .map((m) => m.content);
        const decision = await geminiText.classifyMemoryCandidate(item.text, existing);

        if (decision.failed) {
          item.tries += 1;
          queue = item.tries >= MAX_TRIES ? queue.slice(1) : queue;
          writeQueue(queue);
          break;
        }

        if (decision.shouldRemember) await this.saveAll(decision.memories, item.source);
        queue = queue.slice(1);
        writeQueue(queue);
      }
    } catch (err) {
      console.warn("[MemoryLearner] Drain error:", err);
    } finally {
      this.draining = false;
    }
  }
}

export const memoryLearner = new MemoryLearner();