/**
 * Prompt API Schema definitions
 *
 * Contains all prompt-related endpoints for CRUD, version management, and reordering.
 */

import type { Prompt, PromptVersion } from '@shared/data/types/prompt'

// ============================================================================
// DTOs
// ============================================================================

export interface CreatePromptDto {
  title: string
  content: string
}

export interface UpdatePromptDto {
  title?: string
  content?: string
}

export interface ReorderPromptsDto {
  /** Array of { id, sortOrder } pairs */
  items: Array<{ id: string; sortOrder: number }>
}

export interface RollbackPromptDto {
  /** Target version number to rollback to */
  version: number
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface PromptSchemas {
  '/prompts': {
    /** Get all prompts */
    GET: {
      response: Prompt[]
    }
    /** Create a new prompt */
    POST: {
      body: CreatePromptDto
      response: Prompt
    }
  }

  '/prompts/reorder': {
    /** Batch update sort order */
    PATCH: {
      body: ReorderPromptsDto
      response: void
    }
  }

  '/prompts/:id': {
    /** Get a prompt by ID */
    GET: {
      params: { id: string }
      response: Prompt
    }
    /** Update a prompt (auto-creates version if content changed) */
    PATCH: {
      params: { id: string }
      body: UpdatePromptDto
      response: Prompt
    }
    /** Delete a prompt and all its versions */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/prompts/:id/versions': {
    /** Get version history for a prompt */
    GET: {
      params: { id: string }
      response: PromptVersion[]
    }
  }

  '/prompts/:id/rollback': {
    /** Rollback to a previous version */
    POST: {
      params: { id: string }
      body: RollbackPromptDto
      response: Prompt
    }
  }
}
