export const CHERRY_NODE_PROXY_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_RULES'
export const CHERRY_NODE_PROXY_BYPASS_RULES_ENV = 'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES'

const NODE_PROXY_ENV_KEYS = [
  CHERRY_NODE_PROXY_RULES_ENV,
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV,
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'NO_PROXY',
  'no_proxy',
  'grpc_proxy'
] as const

export interface NodeProxyConfig {
  proxyRules?: string
  proxyBypassRules?: string | string[]
}

export const normalizeProxyBypassRules = (rules?: string | string[]): string[] => {
  if (Array.isArray(rules)) {
    return rules.map((rule) => rule.trim()).filter((rule) => rule.length > 0)
  }

  return rules
    ? rules
        .split(/[;,]/)
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0)
    : []
}

export const getProxyEnvironment = (env: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const proxyEnv: Record<string, string> = {}

  for (const key of NODE_PROXY_ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') {
      proxyEnv[key] = value
    }
  }

  return proxyEnv
}

export const getProxyProtocol = (proxyRules?: string): string | null => {
  if (!proxyRules) {
    return null
  }

  try {
    return new URL(proxyRules).protocol.replace(':', '').toLowerCase()
  } catch {
    return null
  }
}

export const isSocksProxyProtocol = (protocol: string | null): boolean => {
  return protocol !== null && protocol.startsWith('socks')
}

export const buildNodeProxyEnvironment = (config: NodeProxyConfig): Record<string, string> => {
  const proxyUrl = config.proxyRules?.trim()
  if (!proxyUrl) {
    return {}
  }

  const normalizedByPassRules = normalizeProxyBypassRules(config.proxyBypassRules)
  const proxyProtocol = getProxyProtocol(proxyUrl)
  const env: Record<string, string> = {
    [CHERRY_NODE_PROXY_RULES_ENV]: proxyUrl,
    [CHERRY_NODE_PROXY_BYPASS_RULES_ENV]: normalizedByPassRules.join(',')
  }

  if (normalizedByPassRules.length > 0) {
    env.NO_PROXY = normalizedByPassRules.join(',')
    env.no_proxy = normalizedByPassRules.join(',')
  }

  if (isSocksProxyProtocol(proxyProtocol)) {
    env.SOCKS_PROXY = proxyUrl
    env.socks_proxy = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.all_proxy = proxyUrl
    return env
  }

  env.grpc_proxy = proxyUrl
  env.HTTP_PROXY = proxyUrl
  env.HTTPS_PROXY = proxyUrl
  env.http_proxy = proxyUrl
  env.https_proxy = proxyUrl
  env.ALL_PROXY = proxyUrl
  env.all_proxy = proxyUrl

  return env
}
