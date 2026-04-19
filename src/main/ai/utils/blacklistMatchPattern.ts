/**
 * Regex / URL pattern utilities for web-search blocklists.
 *
 * Port of `mapRegexToPatterns` from `src/renderer/src/utils/blacklistMatchPattern.ts`
 * (origin/main L206). Kept standalone in main so `@main/ai/utils/websearch.ts`
 * no longer needs the renderer stub.
 */

/**
 * Normalize a mix of regex-wrapped (`/.../`), URL (`https://foo.com`) and
 * plain-domain (`foo.com`) entries to a deduped lowercase domain list
 * suitable for provider `excludeDomains` / `blockedDomains` APIs.
 */
export function mapRegexToPatterns(patterns: string[]): string[] {
  const patternSet = new Set<string>()
  const domainMatcher = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

  patterns.forEach((pattern) => {
    if (!pattern) return

    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      const rawPattern = pattern.slice(1, -1)
      const normalizedPattern = rawPattern.replace(/\\\./g, '.').replace(/\\\//g, '/')
      const matches = normalizedPattern.match(domainMatcher)
      if (matches) {
        matches.forEach((match) => {
          patternSet.add(match.replace(/http(s)?:\/\//g, '').toLowerCase())
        })
      }
    } else if (pattern.includes('://')) {
      const matches = pattern.match(domainMatcher)
      if (matches) {
        matches.forEach((match) => {
          patternSet.add(match.replace(/http(s)?:\/\//g, '').toLowerCase())
        })
      }
    } else {
      patternSet.add(pattern.toLowerCase())
    }
  })

  return Array.from(patternSet)
}
