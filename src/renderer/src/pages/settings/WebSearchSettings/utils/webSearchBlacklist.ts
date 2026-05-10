import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'

export type WebSearchBlacklistParseResult = {
  validDomains: string[]
  hasError: boolean
}

export function parseWebSearchBlacklistInput(input: string): WebSearchBlacklistParseResult {
  const entries = input.split('\n').filter((url) => url.trim() !== '')
  const validDomains: string[] = []
  const hasError = entries.some((entry) => {
    const trimmedEntry = entry.trim()

    if (trimmedEntry.startsWith('/') && trimmedEntry.endsWith('/')) {
      try {
        const regexPattern = trimmedEntry.slice(1, -1)
        new RegExp(regexPattern, 'i')
        validDomains.push(trimmedEntry)
        return false
      } catch {
        return true
      }
    }

    const parsed = parseMatchPattern(trimmedEntry)
    if (parsed === null) {
      return true
    }

    validDomains.push(trimmedEntry)
    return false
  })

  return { validDomains, hasError }
}
