import type { ApiServerConfig } from '@types'

export const shouldStartApiServerOnLaunch = (config: ApiServerConfig, agentTotal: number): boolean => {
  if (config.enabled) return true
  if (!config.autoStart) return false
  return agentTotal > 0
}
