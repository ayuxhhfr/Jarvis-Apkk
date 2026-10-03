/**
 * Memory data types and contracts for JARVIS long-term memory system.
 */

export type MemoryCategory =
  | 'personal'
  | 'preference'
  | 'project'
  | 'instruction'
  | 'routine'
  | 'technical'
  | 'other';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number; // 1 to 5 scale
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  source?: 'user_explicit' | 'inferred' | 'voice_command' | 'manual';
  active: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string; // ISO string
}

export interface MemoryFilter {
  category?: MemoryCategory;
  query?: string;
  activeOnly?: boolean;
  limit?: number;
}
