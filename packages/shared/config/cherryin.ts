export const CHERRYIN_HOSTS = {
  china: 'https://open.cherryin.net',
  global: 'https://open.cherryin.ai'
} as const

export type CherryInHost = (typeof CHERRYIN_HOSTS)[keyof typeof CHERRYIN_HOSTS]
export type CherryInHostMode = 'auto' | keyof typeof CHERRYIN_HOSTS
export type CherryInSelectionSource = 'fallback' | 'manual' | 'probe'

export interface CherryInEndpointSelection {
  host: CherryInHost
  mode: CherryInHostMode
  source: CherryInSelectionSource
}

export interface CherryInEndpoints {
  anthropicApiHost: CherryInHost
  apiHost: CherryInHost
  apiKey: string
  docs: string
  models: string
  oauth: CherryInHost
  official: CherryInHost
  topup: string
}

const CHERRYIN_HOST_SET = new Set<CherryInHost>(Object.values(CHERRYIN_HOSTS))
const CHERRYIN_HOST_MODE_SET = new Set<CherryInHostMode>(['auto', 'china', 'global'])

export function isCherryInHost(value: unknown): value is CherryInHost {
  return typeof value === 'string' && CHERRYIN_HOST_SET.has(value as CherryInHost)
}

export function isCherryInHostMode(value: unknown): value is CherryInHostMode {
  return typeof value === 'string' && CHERRYIN_HOST_MODE_SET.has(value as CherryInHostMode)
}

export function resolveCherryInHost(value: string | undefined, fallback = CHERRYIN_HOSTS.global): CherryInHost {
  if (!value) return fallback

  try {
    const origin = new URL(value).origin
    return isCherryInHost(origin) ? origin : fallback
  } catch {
    return fallback
  }
}

export function getCherryInEndpoints(host: CherryInHost): CherryInEndpoints {
  return {
    anthropicApiHost: host,
    apiHost: host,
    apiKey: `${host}/console/token`,
    docs: host,
    models: `${host}/pricing`,
    oauth: host,
    official: host,
    topup: `${host}/console/topup`
  }
}
