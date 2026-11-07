import * as z from 'zod'

import { loggerService } from '@logger'
import {
  ClaudePluginsSearchResponseSchema,
  SkillsShSearchItemSchema,
  type SkillSearchResult,
  type SkillSearchSource
} from '@shared/types/skill'
import {
  normalizeClaudePlugins,
  normalizeSkillsSh,
  searchSkillMarketplaces,
  SKILL_SEARCH_FAILED_ERROR as SHARED_SKILL_SEARCH_FAILED_ERROR
} from '@shared/utils/skillMarketplace'

const logger = loggerService.withContext('skillSearch')

const REQUEST_TIMEOUT_MS = 15_000
export const SKILL_SEARCH_FAILED_ERROR = SHARED_SKILL_SEARCH_FAILED_ERROR

// ===========================================================================
// Fetch helpers
// ===========================================================================

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetchWithTimeout(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Search all 3 skill registries.
 * Preserves partial success, but rejects when every source fails.
 */
export async function searchSkills(query: string, source?: SkillSearchSource): Promise<SkillSearchResult[]> {
  return searchSkillMarketplaces(
    query,
    fetchJson,
    (source, error) => {
      logger.warn(`${source} search failed`, {
        error: error instanceof Error ? error.message : String(error)
      })
    },
    source
  )
}

const skillsShLeaderboardSchema = z.object({
  skills: z.array(SkillsShSearchItemSchema.omit({ id: true })),
  page: z.number().int().nonnegative(),
  hasMore: z.boolean()
})

export async function loadSkillsShLeaderboard(page: number) {
  const data = skillsShLeaderboardSchema.parse(await fetchJson('https://skills.sh/api/skills/all-time/' + page))
  if (data.page !== page || (data.hasMore && data.skills.length === 0)) throw new Error('Invalid skills.sh pagination')
  const items = normalizeSkillsSh({
    query: '',
    count: data.skills.length,
    skills: data.skills.map((skill) => ({ ...skill, id: skill.source + '/' + skill.skillId }))
  })
  return { items, hasMore: data.hasMore }
}

export async function loadSkillRegistryPage(source: 'skills.sh' | 'claude-plugins.dev', cursor: number) {
  try {
    if (source === 'skills.sh') {
      const page = await loadSkillsShLeaderboard(cursor)
      return { ...page, nextCursor: cursor + 1 }
    }
    const page = await loadClaudePluginsSkills(cursor, fetchJson)
    return { items: page.items, hasMore: page.hasMore, nextCursor: page.nextOffset }
  } catch (error) {
    logger.warn('Skill registry page failed', { source, cursor, error })
    throw error
  }
}

/** Browse the independent skills catalog; pagination counts raw entries, including skipped ones. */
export async function loadClaudePluginsSkills(
  offset: number,
  fetchJson: (url: string) => Promise<unknown>,
  limit = 20
): Promise<{ items: SkillSearchResult[]; hasMore: boolean; nextOffset: number }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid claude-plugins.dev pagination')
  }
  const url = new URL('https://claude-plugins.dev/api/skills')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))
  const data = ClaudePluginsSearchResponseSchema.parse(await fetchJson(url.toString()))
  const total = data.total
  if (
    data.offset !== offset ||
    data.limit !== limit ||
    total === undefined ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    data.skills.length > limit ||
    (data.skills.length === 0 && offset < total)
  ) {
    throw new Error('Invalid claude-plugins.dev pagination')
  }
  const nextOffset = offset + data.skills.length
  return { items: normalizeClaudePlugins(data), hasMore: nextOffset < total, nextOffset }
}
