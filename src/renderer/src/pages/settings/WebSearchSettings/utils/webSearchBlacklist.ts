import { loggerService } from '@logger'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'

const logger = loggerService.withContext('WebSearchBlacklist')

export type WebSearchBlacklistParseResult = {
  validDomains: string[]
  hasError: boolean
  invalidEntries: string[]
}

export function parseWebSearchBlacklistInput(input: string): WebSearchBlacklistParseResult {
  const entries = input.split('\n').filter((url) => url.trim() !== '')
  const validDomains: string[] = []
  const invalidEntries: string[] = []

  for (const entry of entries) {
    const trimmedEntry = entry.trim()

    if (trimmedEntry.startsWith('/') && trimmedEntry.endsWith('/')) {
      try {
        const regexPattern = trimmedEntry.slice(1, -1)
        new RegExp(regexPattern, 'i')
        validDomains.push(trimmedEntry)
        continue
      } catch {
        logger.warn('Invalid web search blacklist regular expression', { pattern: trimmedEntry })
        invalidEntries.push(trimmedEntry)
        continue
      }
    }

    const parsed = parseMatchPattern(trimmedEntry)
    if (parsed === null) {
      invalidEntries.push(trimmedEntry)
      continue
    }

    validDomains.push(trimmedEntry)
  }

  return { validDomains, hasError: invalidEntries.length > 0, invalidEntries }
}
