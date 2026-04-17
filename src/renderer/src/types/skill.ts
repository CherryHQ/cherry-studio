/**
 * Skill types shared between main and renderer processes.
 *
 * Zod schemas serve as both runtime validators and TypeScript type source.
 */

import * as z from 'zod'

// ============================================================================
// Search source registries
// ============================================================================

export const SkillSearchSourceSchema = z.enum(['claude-plugins.dev', 'skills.sh', 'clawhub.ai'])
export type SkillSearchSource = z.infer<typeof SkillSearchSourceSchema>

// ============================================================================
// API response schemas — claude-plugins.dev
// ============================================================================

export const ClaudePluginsSkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  namespace: z.string(),
  sourceUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  stars: z.number().optional(),
  installs: z.number().optional(),
  metadata: z
    .object({
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      directoryPath: z.string().optional(),
      rawFileUrl: z.string().optional()
    })
    .nullable()
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})
export type ClaudePluginsSkillItem = z.infer<typeof ClaudePluginsSkillItemSchema>

export const ClaudePluginsSearchResponseSchema = z.object({
  skills: z.array(ClaudePluginsSkillItemSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
})

// ============================================================================
// API response schemas — skills.sh
// ============================================================================

export const SkillsShSearchItemSchema = z.object({
  id: z.string(), // "owner/repo/skill-name"
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string() // "owner/repo"
})
export type SkillsShSearchItem = z.infer<typeof SkillsShSearchItemSchema>

export const SkillsShSearchResponseSchema = z.object({
  query: z.string(),
  skills: z.array(SkillsShSearchItemSchema),
  count: z.number()
})

// ============================================================================
// API response schemas — clawhub.ai
// ============================================================================

export const ClawhubSearchItemSchema = z.object({
  score: z.number(),
  slug: z.string(),
  displayName: z.string(),
  summary: z.string(),
  version: z.string().nullable(),
  updatedAt: z.number()
})
export type ClawhubSearchItem = z.infer<typeof ClawhubSearchItemSchema>

export const ClawhubSearchResponseSchema = z.object({
  results: z.array(ClawhubSearchItemSchema)
})

export const ClawhubSkillDetailSchema = z.object({
  skill: z.object({
    slug: z.string(),
    displayName: z.string(),
    summary: z.string(),
    tags: z.record(z.string(), z.string()).optional(),
    stats: z
      .object({
        downloads: z.number().default(0),
        stars: z.number().default(0),
        installsAllTime: z.number().default(0)
      })
      .optional()
  }),
  owner: z
    .object({
      handle: z.string(),
      displayName: z.string(),
      image: z.string().nullable()
    })
    .nullable(),
  moderation: z
    .object({
      isSuspicious: z.boolean(),
      isMalwareBlocked: z.boolean(),
      verdict: z.string()
    })
    .nullable()
})
export type ClawhubSkillDetail = z.infer<typeof ClawhubSkillDetailSchema>

// ============================================================================
// Unified skill search result (normalized across all sources)
// ============================================================================

export const SkillSearchResultSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  stars: z.number().default(0),
  downloads: z.number().default(0),
  sourceRegistry: SkillSearchSourceSchema,
  sourceUrl: z.string().nullable().default(null), // URL to the skill's page on the registry
  installSource: z.string() // opaque handle passed to install IPC
})
export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>

// ============================================================================
// Installed skill (returned from DB via IPC)
// ============================================================================

export const InstalledSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderName: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  namespace: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.string()),
  contentHash: z.string(),
  isEnabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

// ============================================================================
// IPC option types
// ============================================================================

export interface SkillInstallOptions {
  installSource: string
}

export interface SkillToggleOptions {
  skillId: string
  agentId: string
  isEnabled: boolean
}

export interface SkillInstallFromZipOptions {
  zipFilePath: string
}

export interface SkillInstallFromDirectoryOptions {
  directoryPath: string
}

export type SkillResult<T> = { success: true; data: T } | { success: false; error: unknown }

// ============================================================================
// File tree node (for skill detail file browser)
// ============================================================================

export interface SkillFileNode {
  name: string
  path: string // relative path from skill root
  type: 'file' | 'directory'
  children?: SkillFileNode[]
}

// ============================================================================
// Legacy plugins (per-agent .claude/commands/ and .claude/agents/)
// ============================================================================

export interface LocalSkill {
  name: string
  description?: string
  filename: string
}
