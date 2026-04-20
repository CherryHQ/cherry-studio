export type KeywordMatchMode = 'whole-word' | 'substring'

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitKeywordsToTerms(keywords: string): string[] {
  return (keywords || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

function buildWholeWordPattern(escapedTerm: string): string {
  // "Whole word" here means: do not match inside a larger alphanumeric token.
  // This avoids false positives like:
  // - API keys: "IMr4WSMS5dwa52"
  // - suffixes: "mechanis[m][s]" when searching "sms"
  return `(?<![\\p{L}\\p{N}])${escapedTerm}(?![\\p{L}\\p{N}])`
}

function addRegexFlag(flags: string, flag: string): string {
  return flags.includes(flag) ? flags : `${flags}${flag}`
}

export function buildKeywordPattern(term: string, matchMode: KeywordMatchMode): string {
  const escaped = escapeRegex(term)
  return matchMode === 'whole-word' ? buildWholeWordPattern(escaped) : escaped
}

export function buildKeywordRegex(term: string, options: { matchMode: KeywordMatchMode; flags?: string }): RegExp {
  const flags = options.flags ?? 'i'
  const normalizedFlags = options.matchMode === 'whole-word' ? addRegexFlag(flags, 'u') : flags
  return new RegExp(buildKeywordPattern(term, options.matchMode), normalizedFlags)
}

export function buildKeywordRegexes(
  terms: string[],
  options: { matchMode: KeywordMatchMode; flags?: string }
): RegExp[] {
  return terms.filter((term) => term.length > 0).map((term) => buildKeywordRegex(term, options))
}

export function buildKeywordUnionRegex(
  terms: string[],
  options: { matchMode: KeywordMatchMode; flags?: string }
): RegExp | null {
  const uniqueTerms = Array.from(new Set(terms.filter((term) => term.length > 0)))
  if (uniqueTerms.length === 0) return null

  const patterns = uniqueTerms
    .sort((a, b) => b.length - a.length)
    .map((term) => buildKeywordPattern(term, options.matchMode))

  const flags = options.flags ?? 'gi'
  const normalizedFlags = options.matchMode === 'whole-word' ? addRegexFlag(flags, 'u') : flags
  return new RegExp(patterns.join('|'), normalizedFlags)
}
