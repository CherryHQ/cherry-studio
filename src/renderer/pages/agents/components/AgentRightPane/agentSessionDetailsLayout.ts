export const AGENT_DETAILS_WIDTH = 280
export const AGENT_DETAILS_INSET = AGENT_DETAILS_WIDTH + 32 + 12

export type AgentDetailsMode = 'inline' | 'popover'

export function resolveAgentDetailsMode(width: number, height: number, previous: AgentDetailsMode): AgentDetailsMode {
  const minimumWidth = previous === 'inline' ? 976 : 980
  return width >= minimumWidth && height >= 160 ? 'inline' : 'popover'
}
