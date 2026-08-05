export const CHERRYIN_HOSTS = {
  china: 'https://open.cherryin.net',
  global: 'https://open.cherryin.ai'
} as const

export type CherryInHost = (typeof CHERRYIN_HOSTS)[keyof typeof CHERRYIN_HOSTS]
export type CherryInHostMode = 'auto' | keyof typeof CHERRYIN_HOSTS

export interface CherryInEndpointSelection {
  host: CherryInHost
  mode: CherryInHostMode
}

const HOSTS = new Set<CherryInHost>(Object.values(CHERRYIN_HOSTS))
const MODES = new Set<CherryInHostMode>(['auto', 'china', 'global'])

export function isCherryInHost(value: unknown): value is CherryInHost {
  return typeof value === 'string' && HOSTS.has(value as CherryInHost)
}

export function isCherryInHostMode(value: unknown): value is CherryInHostMode {
  return typeof value === 'string' && MODES.has(value as CherryInHostMode)
}

export function resolveCherryInHost(value?: string, fallback: CherryInHost = CHERRYIN_HOSTS.global): CherryInHost {
  if (!value) return fallback
  try {
    const origin = new URL(value).origin
    return isCherryInHost(origin) ? origin : fallback
  } catch {
    return fallback
  }
}

export function getCherryInEndpoints(host: CherryInHost) {
  return {
    apiKey: `${host}/console/token`,
    docs: host,
    models: `${host}/pricing`,
    oauth: host,
    official: host,
    topup: `${host}/console/topup`
  }
}
