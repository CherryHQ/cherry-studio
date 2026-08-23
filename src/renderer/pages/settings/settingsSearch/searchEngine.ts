import { toPinyinForms } from './pinyin'
import type { SettingsSearchResult, SettingsSearchSection } from './types'
import { getSettingDomId } from './types'

export const SETTINGS_SEARCH_QUERY_MAX_BYTES = 2048
export const SETTINGS_SEARCH_MAX_RESULTS = 50

// Four-tier scoring (Orca-style): section title > entry title > description > alias,
// each tier split into exact / prefix / substring. Pinyin hits score at the owning
// tier's substring grade (dl / daili match 代理 as a title substring would).
const TIER = {
  section: { exact: 900, prefix: 850, substring: 800 },
  title: { exact: 700, prefix: 650, substring: 600 },
  description: { exact: 500, prefix: 450, substring: 400 },
  alias: { exact: 300, prefix: 250, substring: 200 }
} as const

type Tier = (typeof TIER)[keyof typeof TIER]
type MatchLevel = keyof Tier
type Translate = (key: string) => string

function matchLevel(haystack: string, needle: string): MatchLevel | undefined {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h === n) return 'exact'
  if (h.startsWith(n)) return 'prefix'
  if (h.includes(n)) return 'substring'
  return undefined
}

/** Pinyin match (full or initials) against Chinese text; latin-only text never matches here */
function pinyinMatch(text: string, query: string): boolean {
  const { full, initials } = toPinyinForms(text)
  if (!full) return false
  const q = query.toLowerCase()
  return full.includes(q) || initials.includes(q)
}

function scoreField(text: string, query: string, tier: Tier, allowPinyin: boolean): number {
  const level = matchLevel(text, query)
  if (level) return tier[level]
  if (allowPinyin && pinyinMatch(text, query)) return tier.substring
  return 0
}

interface Candidate {
  score: number
  sectionIndex: number
  /** -1 for the section-level baseline entry so it tie-breaks before its leaves */
  entryIndex: number
  result: SettingsSearchResult
}

export function isQueryTooLarge(query: string): boolean {
  return new TextEncoder().encode(query).length > SETTINGS_SEARCH_QUERY_MAX_BYTES
}

/**
 * Ranks settings sections and leaf entries against a query.
 * Pure function: sections carry the deterministic order (menu order → declaration
 * order) used as the tie-break, so equal scores keep a stable, predictable list.
 */
export function rankEntries(
  query: string,
  sections: readonly SettingsSearchSection[],
  t: Translate
): SettingsSearchResult[] {
  const trimmed = query.trim()
  if (!trimmed || isQueryTooLarge(trimmed)) return []

  const candidates: Candidate[] = []
  sections.forEach((section, sectionIndex) => {
    const sectionTitle = t(section.sectionTitleKey)
    const breadcrumb = [sectionTitle]

    const sectionScore = scoreField(sectionTitle, trimmed, TIER.section, true)
    if (sectionScore > 0) {
      candidates.push({
        score: sectionScore,
        sectionIndex,
        entryIndex: -1,
        result: { route: section.route, title: sectionTitle, breadcrumb, score: sectionScore }
      })
    }

    section.entries.forEach((entry, entryIndex) => {
      const title = t(entry.titleKey)
      const description = entry.descriptionKey ? t(entry.descriptionKey) : undefined
      const route = entry.route ?? section.route
      const entryBreadcrumb = [...(entry.groupKey ? [t(entry.groupKey)] : []), ...breadcrumb]

      const score = Math.max(
        scoreField(title, trimmed, TIER.title, true),
        description ? scoreField(description, trimmed, TIER.description, false) : 0,
        ...(entry.aliases?.map((alias) => scoreField(alias, trimmed, TIER.alias, true)) ?? [0])
      )
      if (score <= 0) return

      candidates.push({
        score,
        sectionIndex,
        entryIndex,
        result: {
          route,
          focusId: getSettingDomId(route, entry.anchorId),
          title,
          description,
          breadcrumb: entryBreadcrumb,
          score
        }
      })
    })
  })

  return candidates
    .sort((a, b) => b.score - a.score || a.sectionIndex - b.sectionIndex || a.entryIndex - b.entryIndex)
    .slice(0, SETTINGS_SEARCH_MAX_RESULTS)
    .map((c) => c.result)
}
