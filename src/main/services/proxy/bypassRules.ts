import * as ipaddr from 'ipaddr.js'

export interface NodeProxyLogger {
  error?: (message: string, ...data: any[]) => void
  warn?: (message: string, ...data: any[]) => void
}

type HostnameMatchType = 'exact' | 'wildcardSubdomain' | 'generalWildcard'

const enum ProxyBypassRuleType {
  Local = 'local',
  Cidr = 'cidr',
  Ip = 'ip',
  Domain = 'domain'
}

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
  return ipaddr.isValid(replaced)
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
      type: ProxyBypassRuleType.Local,
      matchType: 'exact',
      rule: '<local>'
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
    if (ipaddr.isValidCIDR(cleanedCidr)) {
      return {
        type: ProxyBypassRuleType.Cidr,
        matchType: 'exact',
        rule: workingRule,
        scheme,
        cidr: ipaddr.parseCIDR(cleanedCidr)
      }
    }
  }

  let port: string | undefined
  const portMatch = workingRule.match(/^(.+?):(\d+)$/)
  if (portMatch) {
    const potentialHost = portMatch[1]
    if (!potentialHost.startsWith('[') || potentialHost.includes(']')) {
      workingRule = potentialHost
      port = portMatch[2]
    }
  }

  const cleanedHost = workingRule.replace(/^\[|\]$/g, '')
  const normalizedHost = cleanedHost.toLowerCase()

  if (!cleanedHost) {
    return null
  }

  if (ipaddr.isValid(cleanedHost)) {
    return {
      type: ProxyBypassRuleType.Ip,
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
      type: ProxyBypassRuleType.Ip,
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
      type: ProxyBypassRuleType.Domain,
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
      type: ProxyBypassRuleType.Domain,
      matchType: 'wildcardSubdomain',
      rule: workingRule,
      scheme,
      port,
      domain
    }
  }

  if (workingRule.includes('*')) {
    return {
      type: ProxyBypassRuleType.Domain,
      matchType: 'generalWildcard',
      rule: workingRule,
      scheme,
      port,
      regex: buildWildcardRegex(normalizedHost)
    }
  }

  return {
    type: ProxyBypassRuleType.Domain,
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
  if (ipaddr.isValid(cleaned)) {
    const parsed = ipaddr.parse(cleaned)
    return parsed.range() === 'loopback'
  }

  return false
}

export class ProxyBypassRuleMatcher {
  private parsedByPassRules: ParsedProxyBypassRule[] = []

  updateByPassRules(rules: string[], logger?: NodeProxyLogger): void {
    this.parsedByPassRules = []

    for (const rule of rules) {
      const parsedRule = parseProxyBypassRule(rule)
      if (parsedRule) {
        this.parsedByPassRules.push(parsedRule)
      } else {
        logger?.warn?.(`Skipping invalid proxy bypass rule: ${rule}`)
      }
    }
  }

  isByPass(url: string, logger?: NodeProxyLogger) {
    if (this.parsedByPassRules.length === 0) {
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
      const hostnameIsIp = ipaddr.isValid(cleanedHostname)

      for (const rule of this.parsedByPassRules) {
        if (rule.scheme && rule.scheme !== protocolName) {
          continue
        }

        if (rule.port && rule.port !== port) {
          continue
        }

        switch (rule.type) {
          case ProxyBypassRuleType.Local:
            if (isLocalHostname(hostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Ip:
            if (!hostnameIsIp) {
              break
            }

            if (rule.ip && cleanedHostname === rule.ip) {
              return true
            }

            if (rule.regex && rule.regex.test(cleanedHostname)) {
              return true
            }
            break
          case ProxyBypassRuleType.Cidr:
            if (hostnameIsIp && rule.cidr) {
              const parsedHost = ipaddr.parse(cleanedHostname)
              const [cidrAddress, prefixLength] = rule.cidr
              if (parsedHost.kind() === cidrAddress.kind() && parsedHost.match([cidrAddress, prefixLength])) {
                return true
              }
            }
            break
          case ProxyBypassRuleType.Domain:
            if (!hostnameIsIp && matchHostnameRule(hostname, rule)) {
              return true
            }
            break
          default:
            logger?.error?.(`Unknown proxy bypass rule type: ${rule.type}`)
            break
        }
      }
    } catch (error) {
      logger?.error?.('Failed to check bypass:', error as Error)
      return false
    }

    return false
  }
}
