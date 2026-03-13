/**
 * Prompt entity types
 *
 * Prompts are user-managed prompt templates with version history.
 * Replaces the legacy QuickPhrase system.
 * Template variables use ${var} syntax in content and are filled inline by the user.
 */

/**
 * Prompt entity as returned by the API
 */
export interface Prompt {
  id: string
  title: string
  content: string
  currentVersion: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * Prompt version snapshot
 */
export interface PromptVersion {
  id: string
  promptId: string
  version: number
  content: string
  createdAt: string
}
