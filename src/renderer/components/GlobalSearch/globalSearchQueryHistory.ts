import type { GlobalSearchQueryEntry } from '@shared/data/cache/cacheValueTypes'

export const GLOBAL_SEARCH_QUERY_LIMIT = 20
export const GLOBAL_SEARCH_QUERY_DISPLAY_LIMIT = 6

export function sanitizeGlobalSearchQueries(value: unknown): GlobalSearchQueryEntry[] {
  if (!Array.isArray(value)) return []
  const entries: GlobalSearchQueryEntry[] = []
  for (const entry of value) {
    if (
      !entry ||
      typeof entry.query !== 'string' ||
      !entry.query.trim() ||
      typeof entry.lastUsedAt !== 'number' ||
      !Number.isFinite(entry.lastUsedAt) ||
      entry.lastUsedAt < 0
    )
      continue
    entries.push({ query: entry.query.trim(), lastUsedAt: entry.lastUsedAt })
  }
  const seen = new Set<string>()
  return entries
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .filter((entry) => {
      if (seen.has(entry.query)) return false
      seen.add(entry.query)
      return true
    })
    .slice(0, GLOBAL_SEARCH_QUERY_LIMIT)
}

export function rememberGlobalSearchQuery(value: unknown, query: string, now: number): GlobalSearchQueryEntry[] {
  const current = sanitizeGlobalSearchQueries(value)
  const text = query.trim()
  if (!text) return current
  return [{ query: text, lastUsedAt: now }, ...current.filter((entry) => entry.query !== text)].slice(
    0,
    GLOBAL_SEARCH_QUERY_LIMIT
  )
}
