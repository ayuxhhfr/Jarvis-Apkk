/**
 * Real Time-Aware Session & Return Detection Service for JARVIS.
 * Tracks wall-clock session timestamps, accurately categorizes absence intervals,
 * manages return events (guaranteeing greetings trigger only on real returns),
 * and provides temporal context to the assistant.
 */

export type AbsenceCategory =
  | "immediate" // < 2 minutes
  | "short" // 2 - 30 minutes
  | "noticeable" // 30 mins - 6 hours
  | "long" // 6 - 24 hours
  | "day" // 24 - 48 hours (~1 day)
  | "several_days" // 48 hours - 7 days
  | "long_term" // > 7 days
  | "first_visit";

export interface ReturnEvent {
  id: string;
  category: AbsenceCategory;
  elapsedMs: number;
  elapsedFormatted: string;
  lastActiveAt: number;
  currentSessionStartedAt: number;
  isFirstVisit: boolean;
  consumed: boolean;
  suggestedGreeting: {
    jarvis: string;
    ira: string;
  };
}

export interface SessionMetadata {
  firstVisitAt: number;
  lastActiveAt: number;
  lastConversationAt: number;
  lastSessionStartedAt: number;
  lastSessionEndedAt: number;
  currentSessionStartedAt: number;
  currentSessionId: string;
  totalSessions: number;
  pendingReturnEvent: ReturnEvent | null;
}

const SESSION_STORAGE_KEY = "jarvis_session_metadata";

export class SessionService {
  private metadata: SessionMetadata;
  private isInitialized: boolean = false;
  private activityInterval: number | null = null;

  constructor() {
    this.metadata = this.loadMetadata();
  }

  private loadMetadata(): SessionMetadata {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            firstVisitAt: parsed.firstVisitAt || Date.now(),
            lastActiveAt: parsed.lastActiveAt || 0,
            lastConversationAt: parsed.lastConversationAt || 0,
            lastSessionStartedAt: parsed.lastSessionStartedAt || 0,
            lastSessionEndedAt: parsed.lastSessionEndedAt || 0,
            currentSessionStartedAt: parsed.currentSessionStartedAt || Date.now(),
            currentSessionId: parsed.currentSessionId || "session_" + Date.now(),
            totalSessions: parsed.totalSessions || 1,
            pendingReturnEvent: parsed.pendingReturnEvent || null,
          };
        }
      }
    } catch (e) {
      console.warn("Failed to load session metadata from localStorage:", e);
    }

    const now = Date.now();
    return {
      firstVisitAt: now,
      lastActiveAt: 0,
      lastConversationAt: 0,
      lastSessionStartedAt: now,
      lastSessionEndedAt: 0,
      currentSessionStartedAt: now,
      currentSessionId: "session_" + now,
      totalSessions: 0,
      pendingReturnEvent: null,
    };
  }

  private saveMetadata(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.metadata));
      }
    } catch (e) {
      console.warn("Failed to save session metadata to localStorage:", e);
    }
  }

  /**
   * Format elapsed milliseconds into natural human phrasing (e.g. "about 24 hours", "3 days").
   */
  public formatElapsedDuration(elapsedMs: number): string {
    const minutes = Math.floor(elapsedMs / (60 * 1000));
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));

    if (minutes < 2) {
      return "just a moment";
    }
    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    if (hours < 24) {
      const remainingMins = minutes % 60;
      if (remainingMins > 10) {
        return `approximately ${hours} hour${hours === 1 ? "" : "s"} and ${remainingMins} minutes`;
      }
      return `approximately ${hours} hour${hours === 1 ? "" : "s"}`;
    }
    if (days === 1) {
      return "about a day";
    }
    if (days < 7) {
      return `about ${days} days`;
    }
    if (days < 30) {
      const weeks = Math.round(days / 7);
      return `about ${weeks} week${weeks === 1 ? "" : "s"}`;
    }
    return "several weeks";
  }

  /**
   * Determine the absence category based on elapsed wall-clock milliseconds.
   */
  public categorizeAbsence(elapsedMs: number): AbsenceCategory {
    const minutes = elapsedMs / (60 * 1000);
    const hours = elapsedMs / (60 * 60 * 1000);
    const days = elapsedMs / (24 * 60 * 60 * 1000);

    if (minutes < 2) return "immediate";
    if (minutes < 30) return "short";
    if (hours < 6) return "noticeable";
    if (hours < 24) return "long";
    if (days < 2) return "day";
    if (days < 7) return "several_days";
    return "long_term";
  }

  /**
   * Generate natural suggested greetings based on elapsed time and persona.
   */
  private generateSuggestedGreetings(
    category: AbsenceCategory,
    elapsedFormatted: string,
    _isFirstVisit: boolean
  ): { jarvis: string; ira: string } {
    switch (category) {
      case "short":
        return {
          jarvis: `Welcome back, Boss. You were away for about ${elapsedFormatted}.`,
          ira: `Welcome back, Boss! You were away for about ${elapsedFormatted}. Batao, what are we doing?`,
        };
      case "noticeable":
        return {
          jarvis: `Welcome back, Boss. You have been away for approximately ${elapsedFormatted}. All systems are standing by.`,
          ira: `Welcome back, Boss! It's been ${elapsedFormatted} since we last spoke. What are we working on?`,
        };
      case "long":
        return {
          jarvis: `Welcome back, Boss. It has been ${elapsedFormatted} since our last session. Systems stand by.`,
          ira: `Welcome back, Boss! It's been ${elapsedFormatted} since we last spoke. What are we working on?`,
        };
      case "day":
        return {
          jarvis: "Welcome back, Boss. It's been about a day since we last spoke. Standing by for instructions.",
          ira: "Welcome back, Boss! It's been about a day. So glad to have you back, batao what's on the agenda?",
        };
      case "several_days":
        return {
          jarvis: `Good to have you back, Boss. It has been ${elapsedFormatted}. I am ready whenever you are.`,
          ira: `Hey Boss, good to have you back! It's been ${elapsedFormatted}. What are we tackling today?`,
        };
      case "long_term":
        return {
          jarvis: `Welcome back, Boss. It has been ${elapsedFormatted} since our last interaction. All records and memories are intact.`,
          ira: `Boss, welcome back! It's been ${elapsedFormatted}! I've kept everything saved and ready for you.`,
        };
      default:
        return {
          jarvis: "Welcome back, Boss.",
          ira: "Hey Boss, welcome back!",
        };
    }
  }

  /**
   * Initialize or resume session.
   * Crucial order:
   * 1. Read old timestamp.
   * 2. Calculate difference.
   * 3. Determine if return event should be produced.
   * 4. Update session metadata and write to storage.
   */
  public initSession(activeVoice: string = "Charon"): ReturnEvent | null {
    if (this.isInitialized) {
      return this.metadata.pendingReturnEvent;
    }

    const now = Date.now();
    const isFirstVisit = this.metadata.totalSessions === 0 || this.metadata.lastActiveAt === 0;
    const oldLastActive = this.metadata.lastActiveAt;
    const oldSessionStarted = this.metadata.currentSessionStartedAt;
    const elapsedMs = isFirstVisit ? 0 : Math.max(0, now - oldLastActive);
    const category: AbsenceCategory = isFirstVisit ? "first_visit" : this.categorizeAbsence(elapsedMs);
    const elapsedFormatted = this.formatElapsedDuration(elapsedMs);

    let returnEvent: ReturnEvent | null = null;

    // A return event is generated ONLY upon real return after an absence
    // First visits and immediate reloads (< 2 min) do NOT generate a return event
    if (
      !isFirstVisit &&
      (category === "short" ||
        category === "noticeable" ||
        category === "long" ||
        category === "day" ||
        category === "several_days" ||
        category === "long_term")
    ) {
      returnEvent = {
        id: "ret_" + now,
        category,
        elapsedMs,
        elapsedFormatted,
        lastActiveAt: oldLastActive,
        currentSessionStartedAt: now,
        isFirstVisit: false,
        consumed: false,
        suggestedGreeting: this.generateSuggestedGreetings(category, elapsedFormatted, false),
      };
    }

    // Now update session metadata
    this.metadata.totalSessions += 1;
    this.metadata.lastSessionStartedAt = oldSessionStarted;
    this.metadata.lastSessionEndedAt = oldLastActive;
    this.metadata.currentSessionStartedAt = now;
    this.metadata.currentSessionId = "session_" + now + "_" + Math.random().toString(36).substring(2, 6);
    this.metadata.lastActiveAt = now;
    this.metadata.pendingReturnEvent = returnEvent;

    this.saveMetadata();
    this.isInitialized = true;

    // Detailed startup logs as specified
    const prevDateStr = oldLastActive
      ? `${new Date(oldLastActive).toLocaleString()} (${new Date(oldLastActive).toISOString()})`
      : "None (First Visit ever)";
    const currDateStr = `${new Date(now).toLocaleString()} (${new Date(now).toISOString()})`;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
    const elapsedMinutes = (elapsedMs / (60 * 1000)).toFixed(2);
    const elapsedHours = (elapsedMs / (60 * 60 * 1000)).toFixed(2);

    console.log(
      `%c[JARVIS Session Startup] Session & Return Detection`,
      "background: #00ffaa; color: #000; font-weight: bold; padding: 2px 6px; border-radius: 3px;"
    );
    console.log(
      `[JARVIS Session Debug]\n` +
      `  ┌─ Previous Active : ${prevDateStr}\n` +
      `  ├─ Current Startup : ${currDateStr}\n` +
      `  ├─ Raw Elapsed Ms  : ${elapsedMs} ms\n` +
      `  ├─ Elapsed Time    : ${elapsedSeconds}s (${elapsedMinutes} mins, ${elapsedHours} hrs)\n` +
      `  ├─ Formatted Abs.  : "${elapsedFormatted}"\n` +
      `  ├─ Category Output : "${category}" (<2m=immediate, 2-30m=short, 30m-6h=noticeable, 6-24h=long, 24-48h=day)\n` +
      `  ├─ First Visit     : ${isFirstVisit}\n` +
      `  ├─ Total Sessions  : ${this.metadata.totalSessions}\n` +
      `  ├─ Return Event    : ${returnEvent ? `TRUE [Category: ${returnEvent.category}]` : "FALSE (No greeting needed)"}\n` +
      `  ├─ Active Voice    : "${activeVoice}"\n` +
      `  └─ Session ID      : "${this.metadata.currentSessionId}"`
    );

    if (returnEvent) {
      console.log(
        `%c[JARVIS Return Event Generated]`,
        "color: #00ffaa; font-weight: bold;",
        `\n  → JARVIS Greeting: "${returnEvent.suggestedGreeting.jarvis}"\n  → Ira Greeting   : "${returnEvent.suggestedGreeting.ira}"`
      );
    } else {
      console.log(
        `[JARVIS Return Status] No return event created. (Reason: ${
          isFirstVisit
            ? "First visit ever"
            : category === "immediate"
            ? `Immediate reload/revisit (< 2m elapsed: ${elapsedSeconds}s)`
            : "Absence threshold not met"
        })`
      );
    }

    // Setup periodic activity tracker
    if (typeof window !== "undefined") {
      if (this.activityInterval) clearInterval(this.activityInterval);
      this.activityInterval = window.setInterval(() => {
        this.recordActivity();
      }, 5000); // Heartbeat every 5 seconds

      window.addEventListener("beforeunload", () => {
        this.recordActivity();
      });
      window.addEventListener("pagehide", () => {
        this.recordActivity();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.recordActivity();
        }
      });
    }

    return returnEvent;
  }

  /**
   * Record meaningful user activity or heartbeat.
   */
  public recordActivity(isConversation: boolean = false): void {
    const now = Date.now();
    this.metadata.lastActiveAt = now;
    if (isConversation) {
      this.metadata.lastConversationAt = now;
    }
    this.saveMetadata();
  }

  /**
   * Get the pending return event if one exists and hasn't been consumed.
   */
  public getPendingReturnEvent(): ReturnEvent | null {
    if (this.metadata.pendingReturnEvent && !this.metadata.pendingReturnEvent.consumed) {
      return this.metadata.pendingReturnEvent;
    }
    return null;
  }

  /**
   * Consume the return event so it NEVER repeats on subsequent interactions.
   */
  public consumeReturnEvent(): ReturnEvent | null {
    const event = this.getPendingReturnEvent();
    if (event) {
      event.consumed = true;
      this.metadata.pendingReturnEvent = { ...event, consumed: true };
      this.saveMetadata();
      console.log(
        `%c[JARVIS Return Consumed]`,
        "color: #38bdf8; font-weight: bold;",
        `Return event "${event.id}" marked as consumed. Subsequent messages will not trigger another return greeting.`
      );
      return event;
    }
    return null;
  }

  /**
   * Build structured temporal & session context for the model's system prompt or turn.
   */
  public getTemporalContext(assistantName: string = "JARVIS", activeVoiceName: string = "Charon"): string {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    const dateString = now.toLocaleDateString([], {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    const pending = this.getPendingReturnEvent();
    let returnContext = "";

    if (pending) {
      if (pending.isFirstVisit) {
        returnContext = `- Visit Status: FIRST EVER VISIT. Welcome the Boss to their personalized ${assistantName} assistant.`;
      } else {
        returnContext = `- Return Event: Active. The Boss has returned after an absence of ${pending.elapsedFormatted}. (Category: ${pending.category}). Naturally acknowledge this return once in your response.`;
      }
    } else {
      returnContext = `- Return Event: None (Ongoing conversation session). Do not say "Welcome back" or mention time away.`;
    }

    return `\n[SYSTEM TEMPORAL & SESSION AWARENESS]:
- Current Local Time: ${timeString}, ${dateString} (${timeZone})
- Current Session ID: ${this.metadata.currentSessionId}
- Total Sessions To Date: ${this.metadata.totalSessions}
- Active Assistant Persona: ${assistantName}
- Active Spoken Voice: ${activeVoiceName}
- User Title: Boss (The current user is your Boss and owner)
${returnContext}`;
  }

  public getMetadata(): SessionMetadata {
    return { ...this.metadata };
  }
}

export const sessionService = new SessionService();
