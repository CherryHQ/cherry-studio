import { parseMatchPattern } from './blacklistMatchPattern'

/**
 * Parses one uBlacklist subscription line into a usable blacklist rule.
 * Returns the trimmed rule when it is a valid `/regex/` or match pattern,
 * otherwise null so the caller can count and drop it.
 */
export function parseBlacklistRuleLine(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '') return null

  if (trimmed.startsWith('/') && trimmed.endsWith('/') && trimmed.length > 2) {
    try {
      new RegExp(trimmed.slice(1, -1), 'i')
      return trimmed
    } catch {
      return null
    }
  }

  return parseMatchPattern(trimmed) === null ? null : trimmed
}

export const DEFAULT_MAX_SUBSCRIPTION_RULES = 5000

export type UBlacklistParseResult = {
  rules: string[]
  droppedCount: number
}

/**
 * Parses a uBlacklist-format subscription body. Blank lines and `#`/`!`
 * comments are ignored, valid match patterns and `/regex/` rules are kept
 * (deduplicated, capped at `maxRules`), and invalid lines are counted and
 * dropped instead of failing the whole list.
 */
export function parseUBlacklistSubscription(
  body: string,
  { maxRules = DEFAULT_MAX_SUBSCRIPTION_RULES }: { maxRules?: number } = {}
): UBlacklistParseResult {
  const rules: string[] = []
  const seen = new Set<string>()
  let droppedCount = 0

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue

    const rule = parseBlacklistRuleLine(trimmed)
    if (rule === null) {
      droppedCount += 1
      continue
    }
    if (seen.has(rule)) continue
    if (rules.length >= maxRules) break

    seen.add(rule)
    rules.push(rule)
  }

  return { rules, droppedCount }
}

/** True for HTTP(S) URLs, the only schemes a subscription source may use. */
export function isValidSubscriptionUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
