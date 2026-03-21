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

type HostMap<T> = [self: HostMapBucket<T>, anySubdomain: HostMapBucket<T>, subdomains?: Record<string, HostMap<T>>]
type HostMapBucket<T> = [value: T, scheme?: string, path?: string][]

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

class MatchPatternMap<T> {
  static supportedSchemes: string[] = ['http', 'https']

  private allURLs: T[]
  private hostMap: HostMap<T>

  constructor() {
    this.allURLs = []
    this.hostMap = [[], []]
  }

  get(url: string): T[] {
    const { protocol, hostname: host, pathname, search } = new URL(url)
    const scheme = protocol.slice(0, -1)
    const path = `${pathname}${search}`

    if (!MatchPatternMap.supportedSchemes.includes(scheme)) {
      return []
    }

    const values: T[] = [...this.allURLs]
    let node = this.hostMap

    for (const label of host.split('.').reverse()) {
      collectBucket(node[1], scheme, path, values)

      if (!node[2]?.[label]) {
        return values
      }

      node = node[2][label]
    }

    collectBucket(node[1], scheme, path, values)
    collectBucket(node[0], scheme, path, values)
    return values
  }

  set(pattern: string, value: T) {
    const parseResult = parseMatchPattern(pattern)
    if (!parseResult) {
      throw new Error(`Invalid match pattern: ${pattern}`)
    }

    if (parseResult.allURLs) {
      this.allURLs.push(value)
      return
    }

    const { scheme, host, path } = parseResult
    if (scheme !== '*' && !MatchPatternMap.supportedSchemes.includes(scheme)) {
      throw new Error(`Unsupported scheme: ${scheme}`)
    }

    const labels = host.split('.').reverse()
    const anySubdomain = labels[labels.length - 1] === '*'
    if (anySubdomain) {
      labels.pop()
    }

    let node = this.hostMap
    for (const label of labels) {
      node[2] ||= {}
      node = node[2][label] ||= [[], []]
    }

    node[anySubdomain ? 1 : 0].push(
      path === '/*' ? (scheme === '*' ? [value] : [value, scheme]) : [value, scheme, path]
    )
  }
}

function collectBucket<T>(bucket: HostMapBucket<T>, scheme: string, path: string, values: T[]): void {
  for (const [value, schemePattern = '*', pathPattern = '/*'] of bucket) {
    if (testScheme(schemePattern, scheme) && testPath(pathPattern, path)) {
      values.push(value)
    }
  }
}

function testScheme(schemePattern: string, scheme: string): boolean {
  return schemePattern === '*' ? scheme === 'http' || scheme === 'https' : scheme === schemePattern
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

function compileBlacklistPatterns(patterns: string[]) {
  const patternMap = new MatchPatternMap<string>()
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
      patternMap.set(pattern, pattern)
    } catch (error) {
      logger.warn('Invalid web search blacklist match pattern', {
        pattern,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { patternMap, regexPatterns }
}

export function filterWebSearchResponseWithBlacklist(
  response: WebSearchResponse,
  blacklistPatterns: string[]
): WebSearchResponse {
  if (response.results.length === 0 || blacklistPatterns.length === 0) {
    return response
  }

  const { patternMap, regexPatterns } = compileBlacklistPatterns(blacklistPatterns)

  return {
    ...response,
    results: response.results.filter((result) => {
      try {
        const url = new URL(result.url)

        if (regexPatterns.some((regex) => regex.test(url.hostname))) {
          return false
        }

        return patternMap.get(result.url).length === 0
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
