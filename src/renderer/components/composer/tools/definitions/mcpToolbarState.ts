import type { Assistant } from '@renderer/types/assistant'
import { TopicType } from '@renderer/types/topic'
import { DEFAULT_MCP_MODE } from '@shared/data/types/assistant'

/**
 * Whether the composer MCP toolbar shortcut should show activation feedback.
 * Chat: auto mode is always active; manual requires at least one bound server; disabled is idle.
 * Session: active when the agent has at least one MCP binding.
 */
export function isMcpToolbarActive(options: {
  scope: TopicType.Chat | TopicType.Session
  assistant?: (Pick<Assistant, 'mcpServerIds'> & { settings?: Pick<Assistant['settings'], 'mcpMode'> }) | null
  agent?: { mcps?: string[] } | null
}): boolean {
  if (options.scope === TopicType.Session) {
    return (options.agent?.mcps?.length ?? 0) > 0
  }

  const mode = options.assistant?.settings?.mcpMode ?? DEFAULT_MCP_MODE
  if (mode === 'disabled') return false
  if (mode === 'auto') return true
  return (options.assistant?.mcpServerIds?.length ?? 0) > 0
}
