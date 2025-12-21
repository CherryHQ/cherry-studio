export const shouldStartApiServerOnLaunch = (
  enabled: boolean,
  autoStartOnLaunch: boolean,
  agentTotal: number
): boolean => {
  if (enabled) return true
  if (!autoStartOnLaunch) return false
  return agentTotal > 0
}
