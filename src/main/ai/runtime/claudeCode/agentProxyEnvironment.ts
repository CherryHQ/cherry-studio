import { createHash } from 'node:crypto'

import { CHERRY_NODE_PROXY_BYPASS_RULES_ENV, CHERRY_NODE_PROXY_RULES_ENV } from '@main/services/proxy/proxyEnv'

export type Environment = Readonly<Record<string, string | undefined>>

const AGENT_PROXY_ENDPOINT_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'grpc_proxy'
] as const

const AGENT_PROXY_BYPASS_KEYS = ['NO_PROXY', 'no_proxy'] as const
const AGENT_PROXY_ENVIRONMENT_KEYS = [...AGENT_PROXY_ENDPOINT_KEYS, ...AGENT_PROXY_BYPASS_KEYS] as const
const AGENT_PROXY_ENVIRONMENT_KEY_SET = new Set<string>(AGENT_PROXY_ENVIRONMENT_KEYS)
const CHERRY_PROXY_MARKER_KEY_SET = new Set([CHERRY_NODE_PROXY_RULES_ENV, CHERRY_NODE_PROXY_BYPASS_RULES_ENV])
const LOOPBACK_BYPASS_RULES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const

const isNonEmpty = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== ''

const normalizeBypassRules = (environment: Environment): string[] => {
  const rules: string[] = []
  const normalizedRules = new Set<string>()

  for (const value of [environment.no_proxy, environment.NO_PROXY]) {
    if (!value) continue

    for (const rule of value.split(/[\s,;]+/)) {
      if (!rule) continue

      const normalizedRule = rule.toLowerCase()
      if (normalizedRules.has(normalizedRule)) continue

      normalizedRules.add(normalizedRule)
      rules.push(rule)
    }
  }

  return rules
}

export const stripInheritedCherryProxyEnvironment = (environment: Environment): Record<string, string | undefined> => {
  const result = { ...environment }
  const cherryProxyUrl = result[CHERRY_NODE_PROXY_RULES_ENV]
  const cherryBypassRules = result[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]

  delete result[CHERRY_NODE_PROXY_RULES_ENV]
  delete result[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]

  if (cherryProxyUrl !== undefined) {
    for (const key of AGENT_PROXY_ENDPOINT_KEYS) {
      if (result[key] === cherryProxyUrl) {
        delete result[key]
      }
    }
  }

  if (cherryBypassRules !== undefined) {
    for (const key of AGENT_PROXY_BYPASS_KEYS) {
      if (result[key] === cherryBypassRules) {
        delete result[key]
      }
    }
  }

  return result
}

export const isAgentProxyEnvironmentKey = (key: string): boolean =>
  AGENT_PROXY_ENVIRONMENT_KEY_SET.has(key) || CHERRY_PROXY_MARKER_KEY_SET.has(key.toUpperCase())

export const mergeAgentLoopbackProxyBypass = (environment: Environment): Record<string, string | undefined> => {
  const result = { ...environment }
  if (!AGENT_PROXY_ENDPOINT_KEYS.some((key) => isNonEmpty(environment[key]))) {
    return result
  }

  const rules = normalizeBypassRules(environment)
  if (rules.includes('*')) {
    result.no_proxy = '*'
    result.NO_PROXY = '*'
    return result
  }

  const normalizedRules = new Set(rules.map((rule) => rule.toLowerCase()))
  for (const rule of LOOPBACK_BYPASS_RULES) {
    if (!normalizedRules.has(rule.toLowerCase())) {
      rules.push(rule)
    }
  }

  const bypassRules = rules.join(',')
  result.no_proxy = bypassRules
  result.NO_PROXY = bypassRules
  return result
}

export const createAgentProxyEnvironmentFingerprint = (environment: Environment): string => {
  const normalizedEnvironment = mergeAgentLoopbackProxyBypass(environment)
  const fingerprintEntries = AGENT_PROXY_ENVIRONMENT_KEYS.flatMap((key) => {
    const value = normalizedEnvironment[key]
    return isNonEmpty(value) ? [[key, value] as const] : []
  })

  return createHash('sha256').update(JSON.stringify(fingerprintEntries)).digest('hex')
}
