/**
 * Soft reference metadata types
 *
 * These types store snapshots of referenced entities at creation time,
 * preserving display information even if the original entity is deleted.
 */

/**
 * Preserved assistant info for display when assistant is deleted
 * Used in: message.assistantMeta, topic.assistantMeta
 */
export interface AssistantMeta {
  /** Original assistant ID, used to attempt reference recovery */
  id: string
  /** Assistant display name shown in UI */
  name: string
  /** Assistant icon emoji for visual identification */
  emoji?: string
  /** Assistant type, e.g., 'default', 'custom', 'agent' */
  type?: string
}

/**
 * Preserved model info for display when model is unavailable
 * Used in: message.modelMeta
 */
export interface ModelMeta {
  /** Original model ID, used to attempt reference recovery */
  id: string
  /** Model display name, e.g., "GPT-4o", "Claude 3.5 Sonnet" */
  name: string
  /** Provider identifier, e.g., "openai", "anthropic", "google" */
  provider: string
  /** Model family/group, e.g., "gpt-4", "claude-3", useful for grouping in UI */
  group?: string
}
