import { loggerService } from '@logger'
import type { SkillSearchResult } from '@shared/types/skill'
import {
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
export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  return searchSkillMarketplaces(query, fetchJson, (source, error) => {
    logger.warn(`${source} search failed`, {
      error: error instanceof Error ? error.message : String(error)
    })
  })
}
