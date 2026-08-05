import { createHash } from 'node:crypto'

import { CHERRY_NODE_PROXY_BYPASS_RULES_ENV, CHERRY_NODE_PROXY_RULES_ENV } from '@main/services/proxy/proxyEnv'

export type Environment = Readonly<Record<string, string | undefined>>

interface AgentProxyEnvironmentOptions {
  platform?: NodeJS.Platform
  additionalBypassRule?: string
}

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
const AGENT_PROXY_ENDPOINT_NORMALIZED_KEYS = [...new Set(AGENT_PROXY_ENDPOINT_KEYS.map((key) => key.toLowerCase()))]
const AGENT_PROXY_ENDPOINT_NORMALIZED_KEY_SET = new Set(AGENT_PROXY_ENDPOINT_NORMALIZED_KEYS)
const AGENT_PROXY_ENVIRONMENT_NORMALIZED_KEY_SET = new Set(AGENT_PROXY_ENVIRONMENT_KEYS.map((key) => key.toLowerCase()))
const AGENT_PROXY_BYPASS_NORMALIZED_KEY_SET = new Set(['no_proxy'])
const CHERRY_PROXY_MARKER_KEY_SET = new Set([CHERRY_NODE_PROXY_RULES_ENV, CHERRY_NODE_PROXY_BYPASS_RULES_ENV])
const LOOPBACK_BYPASS_RULES = ['localhost', '127.0.0.1', '::1', '[::1]'] as const

const isNonEmpty = (value: string | undefined): value is string => typeof value === 'string' && value.trim() !== ''

const compareEnvironmentKeys = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const selectWindowsEnvironmentEntries = (
  environment: Environment,
  normalizedKeys: ReadonlySet<string>
): Map<string, readonly [key: string, value: string]> => {
  // Node sorts child-process env keys and passes only the first case-insensitive
  // match on Windows. Mirror that rule so bypass detection and fingerprints
  // describe the environment the Agent subprocess actually receives.
  const selected = new Map<string, readonly [key: string, value: string]>()

  for (const [key, value] of Object.entries(environment).sort(([left], [right]) =>
    compareEnvironmentKeys(left, right)
  )) {
    if (value === undefined) continue

    const normalizedKey = key.toLowerCase()
    if (normalizedKeys.has(normalizedKey) && !selected.has(normalizedKey)) {
      selected.set(normalizedKey, [key, value])
    }
  }

  return selected
}

const normalizeBypassRules = (environment: Environment, platform: NodeJS.Platform): string[] => {
  const rules: string[] = []
  const normalizedRules = new Set<string>()
  const values =
    platform === 'win32'
      ? [selectWindowsEnvironmentEntries(environment, AGENT_PROXY_BYPASS_NORMALIZED_KEY_SET).get('no_proxy')?.[1]]
      : [environment.no_proxy, environment.NO_PROXY]

  for (const value of values) {
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

/** Remove internal metadata only; equal values cannot prove that Cherry owns a shell proxy variable. */
export const stripInheritedCherryProxyMarkers = (environment: Environment): Record<string, string | undefined> => {
  const result = { ...environment }

  delete result[CHERRY_NODE_PROXY_RULES_ENV]
  delete result[CHERRY_NODE_PROXY_BYPASS_RULES_ENV]

  return result
}

export const isAgentProxyEnvironmentKey = (key: string, options: AgentProxyEnvironmentOptions = {}): boolean => {
  const platform = options.platform ?? process.platform
  const isProxyKey =
    platform === 'win32'
      ? AGENT_PROXY_ENVIRONMENT_NORMALIZED_KEY_SET.has(key.toLowerCase())
      : AGENT_PROXY_ENVIRONMENT_KEY_SET.has(key)
  return isProxyKey || CHERRY_PROXY_MARKER_KEY_SET.has(key.toUpperCase())
}

export const mergeAgentLoopbackProxyBypass = (
  environment: Environment,
  options: AgentProxyEnvironmentOptions = {}
): Record<string, string | undefined> => {
  const platform = options.platform ?? process.platform
  const result = { ...environment }
  const activeProxyValues =
    platform === 'win32'
      ? [...selectWindowsEnvironmentEntries(environment, AGENT_PROXY_ENDPOINT_NORMALIZED_KEY_SET).values()].map(
          ([, value]) => value
        )
      : AGENT_PROXY_ENDPOINT_KEYS.map((key) => environment[key])
  if (!activeProxyValues.some(isNonEmpty)) {
    return result
  }

  const rules = normalizeBypassRules(environment, platform)
  if (rules.includes('*')) {
    result.no_proxy = '*'
    result.NO_PROXY = '*'
    return result
  }

  const normalizedRules = new Set(rules.map((rule) => rule.toLowerCase()))
  const requiredRules: readonly string[] = options.additionalBypassRule
    ? [...LOOPBACK_BYPASS_RULES, options.additionalBypassRule]
    : LOOPBACK_BYPASS_RULES
  for (const rule of requiredRules) {
    if (!normalizedRules.has(rule.toLowerCase())) {
      rules.push(rule)
      normalizedRules.add(rule.toLowerCase())
    }
  }

  const bypassRules = rules.join(',')
  result.no_proxy = bypassRules
  result.NO_PROXY = bypassRules
  return result
}

export const createAgentProxyEnvironmentFingerprint = (
  environment: Environment,
  options: AgentProxyEnvironmentOptions = {}
): string => {
  const platform = options.platform ?? process.platform
  const normalizedEnvironment = mergeAgentLoopbackProxyBypass(environment, options)
  const selectedWindowsEndpoints =
    platform === 'win32'
      ? selectWindowsEnvironmentEntries(normalizedEnvironment, AGENT_PROXY_ENDPOINT_NORMALIZED_KEY_SET)
      : undefined
  const fingerprintEntries =
    platform === 'win32'
      ? [
          ...AGENT_PROXY_ENDPOINT_NORMALIZED_KEYS.flatMap((normalizedKey) => {
            const selected = selectedWindowsEndpoints?.get(normalizedKey)
            return selected && isNonEmpty(selected[1]) ? [[normalizedKey, selected[1]] as const] : []
          }),
          ...(isNonEmpty(normalizedEnvironment.NO_PROXY)
            ? ([['no_proxy', normalizedEnvironment.NO_PROXY]] as const)
            : [])
        ]
      : AGENT_PROXY_ENVIRONMENT_KEYS.flatMap((key) => {
          const value = normalizedEnvironment[key]
          return isNonEmpty(value) ? [[key, value] as const] : []
        })

  return createHash('sha256').update(JSON.stringify(fingerprintEntries)).digest('hex')
}
