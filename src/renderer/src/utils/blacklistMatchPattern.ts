/*
 * MIT License
 *
 * Copyright (c) 2018 iorate
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * https://github.com/iorate/ublacklist
 */
export type ParsedMatchPattern =
  | {
      allURLs: true
    }
  | {
      allURLs: false
      scheme: string
      host: string
      path: string
    }

export function parseMatchPattern(pattern: string): ParsedMatchPattern | null {
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

const matchPatternRegExp = (() => {
  const allURLs = String.raw`(?<allURLs><all_urls>)`
  const scheme = String.raw`(?<scheme>\*|[A-Za-z][0-9A-Za-z+.-]*)`
  const label = String.raw`(?:[0-9A-Za-z](?:[0-9A-Za-z-]*[0-9A-Za-z])?)`
  const host = String.raw`(?<host>(?:\*|${label})(?:\.${label})*)`
  const path = String.raw`(?<path>/(?:\*|[0-9A-Za-z._~:/?[\]@!$&'()+,;=-]|%[0-9A-Fa-f]{2})*)`
  return new RegExp(String.raw`^(?:${allURLs}|${scheme}://${host}${path})$`)
})()

export type MatchPatternMapJSON<T> = [allURLs: T[], hostMap: HostMap<T>]

export class MatchPatternMap<T> {
  static supportedSchemes: string[] = ['http', 'https']

  private allURLs: T[]
  private hostMap: HostMap<T>

  constructor(json?: Readonly<MatchPatternMapJSON<T>>) {
    if (json) {
      this.allURLs = json[0]
      this.hostMap = json[1]
    } else {
      this.allURLs = []
      this.hostMap = [[], []]
    }
  }

  toJSON(): MatchPatternMapJSON<T> {
    return [this.allURLs, this.hostMap]
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

type HostMap<T> = [self: HostMapBucket<T>, anySubdomain: HostMapBucket<T>, subdomains?: Record<string, HostMap<T>>]

type HostMapBucket<T> = [value: T, scheme?: string, path?: string][]

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
  let pos = first.length
  for (const part of rest.slice(0, -1)) {
    const partPos = path.indexOf(part, pos)
    if (partPos === -1) {
      return false
    }
    pos = partPos + part.length
  }
  return path.slice(pos).endsWith(rest[rest.length - 1])
}
