import { loggerService } from '@logger'
import type { WebSearchResponse } from '@shared/data/types/webSearch'

const logger = loggerService.withContext('MainWebSearchBlacklist')

type ParsedMatchPattern =
  | {
      allURLs: true
    }
  | {
      allURLs: false
      scheme: string
      host: string
      path: string
    }

const matchPatternRegExp = (() => {
  const allURLs = String.raw`(?<allURLs><all_urls>)`
  const scheme = String.raw`(?<scheme>\*|[A-Za-z][0-9A-Za-z+.-]*)`
  const label = String.raw`(?:[0-9A-Za-z](?:[0-9A-Za-z-]*[0-9A-Za-z])?)`
  const host = String.raw`(?<host>(?:\*|${label})(?:\.${label})*)`
  const path = String.raw`(?<path>/(?:\*|[0-9A-Za-z._~:/?[\]@!$&'()+,;=-]|%[0-9A-Fa-f]{2})*)`
  return new RegExp(String.raw`^(?:${allURLs}|${scheme}://${host}${path})$`)
})()

function parseMatchPattern(pattern: string): ParsedMatchPattern | null {
  const execResult = matchPatternRegExp.exec(pattern)
  if (!execResult) {
    return null
  }

  const groups = execResult.groups as
    | { allURLs: string }
    | { allURLs?: never; scheme: string; host: string; path: string }

  return groups.allURLs != null
    ? { allURLs: true }
    : {
        allURLs: false,
        scheme: groups.scheme.toLowerCase(),
        host: groups.host.toLowerCase(),
        path: groups.path
      }
}
const supportedSchemes = ['http', 'https'] as const

function testScheme(schemePattern: string, scheme: string): boolean {
  return schemePattern === '*' ? scheme === 'http' || scheme === 'https' : scheme === schemePattern
}

function testHost(hostPattern: string, host: string): boolean {
  if (hostPattern === '*') {
    return true
  }

  if (hostPattern.startsWith('*.')) {
    const suffix = hostPattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }

  return host === hostPattern
}

function testPath(pathPattern: string, path: string): boolean {
  if (pathPattern === '/*') {
    return true
  }

  const [first, ...rest] = pathPattern.split('*')
  if (rest.length === 0) {
    return path === first
  }

  if (!path.startsWith(first)) {
    return false
  }

  let position = first.length
  for (const part of rest.slice(0, -1)) {
    const partPosition = path.indexOf(part, position)
    if (partPosition === -1) {
      return false
    }
    position = partPosition + part.length
  }

  return path.slice(position).endsWith(rest[rest.length - 1])
}

function matchesPattern(pattern: ParsedMatchPattern, url: URL): boolean {
  if (pattern.allURLs) {
    return supportedSchemes.includes(url.protocol.slice(0, -1) as (typeof supportedSchemes)[number])
  }

  const scheme = url.protocol.slice(0, -1)
  const host = url.hostname.toLowerCase()
  const path = `${url.pathname}${url.search}`

  return testScheme(pattern.scheme, scheme) && testHost(pattern.host, host) && testPath(pattern.path, path)
}

function compileBlacklistPatterns(patterns: string[]) {
  const matchPatterns: ParsedMatchPattern[] = []
  const regexPatterns: RegExp[] = []

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim()
    if (!pattern) {
      continue
    }

    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      try {
        regexPatterns.push(new RegExp(pattern.slice(1, -1), 'i'))
      } catch (error) {
        logger.warn('Invalid web search blacklist regex pattern', {
          pattern,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      continue
    }

    try {
      const parseResult = parseMatchPattern(pattern)
      if (!parseResult) {
        throw new Error(`Invalid match pattern: ${pattern}`)
      }

      if (
        !parseResult.allURLs &&
        parseResult.scheme !== '*' &&
        !supportedSchemes.includes(parseResult.scheme as (typeof supportedSchemes)[number])
      ) {
        throw new Error(`Unsupported scheme: ${parseResult.scheme}`)
      }

      matchPatterns.push(parseResult)
    } catch (error) {
      logger.warn('Invalid web search blacklist match pattern', {
        pattern,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { matchPatterns, regexPatterns }
}

export function filterWebSearchResponseWithBlacklist(
  response: WebSearchResponse,
  blacklistPatterns: string[]
): WebSearchResponse {
  if (response.results.length === 0 || blacklistPatterns.length === 0) {
    return response
  }

  const { matchPatterns, regexPatterns } = compileBlacklistPatterns(blacklistPatterns)

  return {
    ...response,
    results: response.results.filter((result) => {
      try {
        const url = new URL(result.url)
        const regexTarget = `${url.origin}${url.pathname}${url.search}`

        if (regexPatterns.some((regex) => regex.test(regexTarget))) {
          return false
        }

        return !matchPatterns.some((pattern) => matchesPattern(pattern, url))
      } catch (error) {
        logger.warn('Failed to apply web search blacklist to result URL', {
          url: result.url,
          error: error instanceof Error ? error.message : String(error)
        })
        return true
      }
    })
  }
}
