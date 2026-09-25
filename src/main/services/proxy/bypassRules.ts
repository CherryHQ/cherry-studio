import * as ipaddr from 'ipaddr.js'

export interface NodeProxyLogger {
  error?: (message: string, ...data: any[]) => void
  warn?: (message: string, ...data: any[]) => void
}

export interface ProxyBypassMatcher {
  isByPass(url: string, logger?: NodeProxyLogger): boolean
}

export type ProxyBypassMatcherFactory = typeof createProxyBypassMatcher

type HostnameMatchType = 'exact' | 'wildcardSubdomain' | 'generalWildcard'

type ProxyBypassRuleType = 'local' | 'cidr' | 'ip' | 'domain' | 'loopbackScope'

interface ParsedProxyBypassRule {
  type: ProxyBypassRuleType
  matchType: HostnameMatchType
  rule: string
  scheme?: string
  port?: string
  domain?: string
  regex?: RegExp
  cidr?: [ipaddr.IPv4 | ipaddr.IPv6, number]
  ip?: string
}

/**
 * Shares Electron-style bypass matching across Node proxy backends.
 * ProxyService owns the policy; this matcher only applies the supplied rules.
 */
export function createProxyBypassMatcher(
  ipaddrModule: typeof ipaddr,
  rules: string[],
  logger?: NodeProxyLogger
): ProxyBypassMatcher {
  const getDefaultPortForProtocol = (protocol: string): string | null => {
    switch (protocol.toLowerCase()) {
      case 'http:':
        return '80'
      case 'https:':
        return '443'
      default:
        return null
    }
  }

  const buildWildcardRegex = (pattern: string): RegExp => {
    const escapedSegments = pattern.split('*').map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return new RegExp(`^${escapedSegments.join('.*')}$`, 'i')
  }

  const isWildcardIp = (value: string): boolean => {
    if (!value.includes('*')) {
      return false
    }

    const replaced = value.replace(/\*/g, '0')
    return ipaddrModule.isValid(replaced)
  }

  const matchHostnameRule = (hostname: string, rule: ParsedProxyBypassRule): boolean => {
    const normalizedHostname = hostname.toLowerCase()

    switch (rule.matchType) {
      case 'exact':
        return normalizedHostname === rule.domain
      case 'wildcardSubdomain': {
        const domain = rule.domain
        if (!domain) {
          return false
        }
        return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
      }
      case 'generalWildcard':
        return rule.regex ? rule.regex.test(normalizedHostname) : false
      default:
        return false
    }
  }

  const parseProxyBypassRule = (rule: string): ParsedProxyBypassRule | null => {
    const trimmedRule = rule.trim()
    if (!trimmedRule) {
      return null
    }

    if (trimmedRule === '<local>') {
      return {
        type: 'local',
        matchType: 'exact',
        rule: '<local>'
      }
    }

    if (trimmedRule === '<-loopback>') {
      // Ordered negation of the implicit loopback scope (see isImplicitLoopbackScope): rules are
      // evaluated in order and the first match decides, so `localhost,<-loopback>` keeps loopback
      // bypassed while `<-loopback>` alone sends it through the proxy — Chromium's subtractive
      // directive, spelled as an exclude entry instead of a token to delete.
      return {
        type: 'loopbackScope',
        matchType: 'exact',
        rule: trimmedRule
      }
    }

    let workingRule = trimmedRule
    let scheme: string | undefined
    const schemeMatch = workingRule.match(/^([a-zA-Z][a-zA-Z\d+\-.]*):\/\//)
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase()
      workingRule = workingRule.slice(schemeMatch[0].length)
    }

    if (workingRule.includes('/')) {
      const cleanedCidr = workingRule.replace(/^\[|\]$/g, '')
      if (ipaddrModule.isValidCIDR(cleanedCidr)) {
        return {
          type: 'cidr',
          matchType: 'exact',
          rule: workingRule,
          scheme,
          cidr: ipaddrModule.parseCIDR(cleanedCidr)
        }
      }
    }

    let port: string | undefined
    const portMatch = workingRule.match(/^(.+?):(\d+)$/)
    if (portMatch) {
      const potentialHost = portMatch[1]
      // `::1` is one IPv6 address, not host `:` on port `1`: an unbracketed literal has to survive the
      // split untouched, or every IPv6 rule whose last group is decimal silently stops matching.
      // `isValid` rejects bracketed hosts, so `[::1]:8080` still splits into host + port.
      const isUnbracketedIpv6 = ipaddrModule.isValid(workingRule) && ipaddrModule.parse(workingRule).kind() === 'ipv6'
      if (!isUnbracketedIpv6 && (!potentialHost.startsWith('[') || potentialHost.includes(']'))) {
        workingRule = potentialHost
        port = portMatch[2]
      }
    }

    const cleanedHost = workingRule.replace(/^\[|\]$/g, '')
    const normalizedHost = cleanedHost.toLowerCase()

    if (!cleanedHost) {
      return null
    }

    if (ipaddrModule.isValid(cleanedHost)) {
      return {
        type: 'ip',
        matchType: 'exact',
        rule: cleanedHost,
        scheme,
        port,
        ip: cleanedHost
      }
    }

    if (isWildcardIp(cleanedHost)) {
      const regexPattern = cleanedHost.replace(/\./g, '\\.').replace(/\*/g, '\\d+')
      return {
        type: 'ip',
        matchType: 'generalWildcard',
        rule: cleanedHost,
        scheme,
        port,
        regex: new RegExp(`^${regexPattern}$`)
      }
    }

    if (workingRule.startsWith('*.')) {
      const domain = normalizedHost.slice(2)
      return {
        type: 'domain',
        matchType: 'wildcardSubdomain',
        rule: workingRule,
        scheme,
        port,
        domain
      }
    }

    if (workingRule.startsWith('.')) {
      const domain = normalizedHost.slice(1)
      return {
        type: 'domain',
        matchType: 'wildcardSubdomain',
        rule: workingRule,
        scheme,
        port,
        domain
      }
    }

    if (workingRule.includes('*')) {
      return {
        type: 'domain',
        matchType: 'generalWildcard',
        rule: workingRule,
        scheme,
        port,
        regex: buildWildcardRegex(normalizedHost)
      }
    }

    return {
      type: 'domain',
      matchType: 'exact',
      rule: workingRule,
      scheme,
      port,
      domain: normalizedHost
    }
  }

  const isLocalHostname = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase()
    if (normalized === 'localhost') {
      return true
    }

    const cleaned = hostname.replace(/^\[|\]$/g, '')
    if (ipaddrModule.isValid(cleaned)) {
      const parsed = ipaddrModule.parse(cleaned)
      return parsed.range() === 'loopback'
    }

    return false
  }

  // The implicit scope that `<-loopback>` negates: loopback hostnames (including the Windows-only
  // `loopback` and the legacy `localhost6` aliases), the loopback and unspecified IPv4 ranges,
  // and link-local addresses.
  const isImplicitLoopbackScope = (hostname: string): boolean => {
    if (isLocalHostname(hostname)) {
      return true
    }

    const cleaned = hostname.replace(/^\[|\]$/g, '')
    if (ipaddrModule.isValid(cleaned)) {
      const range = ipaddrModule.parse(cleaned).range()
      if (range === 'linkLocal' || range === 'unspecified') {
        return true
      }
    }

    return ['loopback', 'localhost6', 'localhost6.localdomain6'].includes(cleaned.toLowerCase())
  }

  /**
   * Whether two host strings denote the same address. The URL host is WHATWG-normalized
   * (`[::1]`, lowercased), while a bypass rule keeps the text the user typed (`0:0:0:0:0:0:0:1`,
   * `::FFFF:127.0.0.1`), so text equality alone rejects equivalent IPv6 literals.
   */
  const isSameAddress = (left: string, right: string): boolean => {
    if (left === right) {
      return true
    }

    const parsedLeft = ipaddrModule.parse(left)
    const parsedRight = ipaddrModule.parse(right)
    return (
      parsedLeft.kind() === parsedRight.kind() && parsedLeft.toNormalizedString() === parsedRight.toNormalizedString()
    )
  }

  const parsedByPassRules: ParsedProxyBypassRule[] = []
  for (const rule of rules) {
    const parsedRule = parseProxyBypassRule(rule)
    if (parsedRule) {
      parsedByPassRules.push(parsedRule)
    } else {
      logger?.warn?.(`Skipping invalid proxy bypass rule: ${rule}`)
    }
  }

  return {
    isByPass(url: string, perCallLogger?: NodeProxyLogger): boolean {
      const log = perCallLogger ?? logger
      if (parsedByPassRules.length === 0) {
        return false
      }

      try {
        const parsedUrl = new URL(url)
        const hostname = parsedUrl.hostname
        const cleanedHostname = hostname.replace(/^\[|\]$/g, '')
        const protocol = parsedUrl.protocol
        const protocolName = protocol.replace(':', '').toLowerCase()
        const defaultPort = getDefaultPortForProtocol(protocol)
        const port = parsedUrl.port || defaultPort || ''
        const hostnameIsIp = ipaddrModule.isValid(cleanedHostname)

        for (const rule of parsedByPassRules) {
          if (rule.scheme && rule.scheme !== protocolName) {
            continue
          }

          if (rule.port && rule.port !== port) {
            continue
          }

          switch (rule.type) {
            case 'local':
              if (isLocalHostname(hostname)) {
                return true
              }
              break
            case 'loopbackScope':
              // First match wins: an earlier positive rule has already returned, so reaching this
              // case means the URL is loopback-scope and must NOT bypass.
              if (isImplicitLoopbackScope(hostname)) {
                return false
              }
              break
            case 'ip':
              if (!hostnameIsIp) {
                break
              }

              if (rule.ip && isSameAddress(cleanedHostname, rule.ip)) {
                return true
              }

              if (rule.regex && rule.regex.test(cleanedHostname)) {
                return true
              }
              break
            case 'cidr':
              if (hostnameIsIp && rule.cidr) {
                const parsedHost = ipaddrModule.parse(cleanedHostname)
                const [cidrAddress, prefixLength] = rule.cidr
                if (parsedHost.kind() === cidrAddress.kind() && parsedHost.match([cidrAddress, prefixLength])) {
                  return true
                }
              }
              break
            case 'domain':
              if (!hostnameIsIp && matchHostnameRule(hostname, rule)) {
                return true
              }
              break
            default:
              log?.error?.(`Unknown proxy bypass rule type: ${rule.type}`)
              break
          }
        }
      } catch (error) {
        log?.error?.('Failed to check bypass:', error)
        return false
      }

      return false
    }
  }
}

export class ProxyBypassRuleMatcher {
  private matcher: ProxyBypassMatcher = createProxyBypassMatcher(ipaddr, [])

  updateByPassRules(rules: string[], logger?: NodeProxyLogger): void {
    this.matcher = createProxyBypassMatcher(ipaddr, rules, logger)
  }

  isByPass(url: string, logger?: NodeProxyLogger) {
    return this.matcher.isByPass(url, logger)
  }
}
