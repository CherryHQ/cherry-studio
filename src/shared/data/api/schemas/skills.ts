/**
 * Skills API Schema definitions.
 */

import { SkillSearchSourceSchema } from '@shared/types/skill'
import * as z from 'zod'

export const InstalledSkillSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderName: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  namespace: z.string().nullable(),
  author: z.string().nullable(),
  version: z.string().nullable(),
  /** Skill metadata tags from SKILL.md. */
  sourceTags: z.array(z.string()),
  contentHash: z.string(),
  sourceRegistry: SkillSearchSourceSchema.nullable(),
  canUpdateFromRemote: z.boolean(),
  /** Whether the installed skill is available to any agent. */
  isGlobalEnabled: z.boolean(),
  /** Effective per-agent state. False when no agentId is requested. */
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

/**
 * Query parameters for `GET /skills`.
 *
 * Skills keep their historical direct-array response shape (no pagination UI
 * in the resource library yet), but filtering must still happen in the service
 * SQL layer:
 * - `agentId` controls the effective per-agent `isEnabled` projection;
 *   `isGlobalEnabled` is returned independently for every query.
 * - `search` LIKEs against `name` OR `description`.
 */
export const ListSkillsQuerySchema = z.strictObject({
  agentId: z.string().min(1).optional(),
  search: z.string().trim().min(1).optional()
})
export type ListSkillsQueryParams = z.input<typeof ListSkillsQuerySchema>
export type ListSkillsQuery = z.output<typeof ListSkillsQuerySchema>

/** Query families whose membership can change independently for the skills collection. */
export const SKILL_LIST_MEMBERSHIP_DIMENSIONS = {
  AGENT_ID: 'agentId'
} as const

export const UpdateSkillSchema = z.strictObject({
  isGlobalEnabled: z.boolean()
})
export type UpdateSkillDto = z.infer<typeof UpdateSkillSchema>

export type SkillSchemas = {
  /** List all installed skills (optionally filtered by agent) */
  '/skills': {
    GET: {
      query?: ListSkillsQueryParams
      response: InstalledSkill[]
    }
  }

  /** Get a specific skill by ID */
  '/skills/:skillId': {
    GET: {
      params: { skillId: string }
      response: InstalledSkill
    }
    PATCH: {
      params: { skillId: string }
      body: UpdateSkillDto
      response: InstalledSkill
    }
  }
}
