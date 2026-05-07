export type KeywordMatchMode = 'whole-word' | 'substring'

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitKeywordsToTerms(keywords: string): string[] {
  const input = (keywords || '').trim()
  if (input.length === 0) return []

  const terms: string[] = []
  const pattern = /"([^"]*)"?|'([^']*)'?|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    const term = (match[1] ?? match[2] ?? match[3]).trim()
    if (term.length > 0) {
      terms.push(term.toLowerCase())
    }
  }
  return terms
}

function containsCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text)
}

function buildWholeWordPattern(escapedTerm: string): string {
  // CJK text has no word boundaries — degrade to substring matching
  if (containsCJK(escapedTerm)) {
    return escapedTerm
  }
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
