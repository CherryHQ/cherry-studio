import * as z from 'zod'

import { loggerService } from '@logger'
import { SkillsShSearchItemSchema, type SkillSearchResult, type SkillSearchSource } from '@shared/types/skill'
import {
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
