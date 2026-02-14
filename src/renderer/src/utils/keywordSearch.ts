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
  return `(?<![A-Za-z0-9])${escapedTerm}(?![A-Za-z0-9])`
}

export function buildKeywordPattern(term: string, matchMode: KeywordMatchMode): string {
  const escaped = escapeRegex(term)
  return matchMode === 'whole-word' ? buildWholeWordPattern(escaped) : escaped
}

export function buildKeywordRegex(term: string, options: { matchMode: KeywordMatchMode; flags?: string }): RegExp {
  return new RegExp(buildKeywordPattern(term, options.matchMode), options.flags ?? 'i')
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

  return new RegExp(patterns.join('|'), options.flags ?? 'gi')
}
