import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'

export function isValidRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern.slice(1, -1), 'i')
    return true
  } catch {
    return false
  }
}

export function isValidDomain(domain: string): boolean {
  const trimmed = domain.trim()
  if (!trimmed) return false

  if (trimmed.startsWith('/') && trimmed.endsWith('/')) {
    return isValidRegexPattern(trimmed)
  }

  return parseMatchPattern(trimmed) !== null
}

export function validateDomains(domains: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []

  for (const domain of domains) {
    const trimmed = domain.trim()
    if (!trimmed) continue

    if (isValidDomain(trimmed)) {
      valid.push(trimmed)
    } else {
      invalid.push(trimmed)
    }
  }

  return { valid, invalid }
}

export function parseDomains(text: string): string[] {
  return text
    .split('\n')
    .map((domain) => domain.trim())
    .filter((domain) => domain !== '')
}
