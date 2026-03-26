/**
 * Skill API Schema definitions
 *
 * Contains all skill-related endpoints for the global skill registry.
 */

import type { Skill, SkillSource, SkillVersion } from '@shared/data/types/skill'

// ============================================================================
// DTOs
// ============================================================================

export interface CreateSkillDto {
  name: string
  slug: string
  description?: string
  author?: string
  version?: string
  tags?: string[]
  tools?: string[]
  source: SkillSource
  sourcePath: string
  packageName?: string
  packageVersion?: string
  marketplaceId?: string
  contentHash?: string
  size?: number
}

export interface UpdateSkillDto {
  name?: string
  description?: string
  author?: string
  version?: string
  tags?: string[]
  tools?: string[]
  sourcePath?: string
  packageName?: string
  packageVersion?: string
  marketplaceId?: string
  contentHash?: string
  size?: number
  isEnabled?: boolean
  versionDirPath?: string
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface SkillSchemas {
  '/skills': {
    /** List all registered skills */
    GET: {
      response: Skill[]
    }
    /** Register a new skill */
    POST: {
      body: CreateSkillDto
      response: Skill
    }
  }

  '/skills/:id': {
    /** Get a skill by ID */
    GET: {
      params: { id: string }
      response: Skill
    }
    /** Update a skill */
    PATCH: {
      params: { id: string }
      body: UpdateSkillDto
      response: Skill
    }
    /** Unregister a skill */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/skills/:id/enable': {
    /** Enable a skill */
    PUT: {
      params: { id: string }
      response: Skill
    }
  }

  '/skills/:id/disable': {
    /** Disable a skill */
    PUT: {
      params: { id: string }
      response: Skill
    }
  }

  '/skills/:id/versions': {
    /** List version history for a skill */
    GET: {
      params: { id: string }
      response: SkillVersion[]
    }
  }
}
