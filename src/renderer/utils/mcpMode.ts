import type { Assistant, McpMode } from '@renderer/types/assistant'
import { DEFAULT_MCP_MODE } from '@shared/data/types/assistant'

/**
 * Get the effective MCP mode for an assistant with backward compatibility.
 * v2 keeps `mcpMode` inside `settings` and supplies a default — this helper
 * stays as a thin facade so existing callers don't have to change.
 */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  return assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE
}

/**
 * Whether the assistant can contribute MCP function tools to a request. Main resolves Manual mode with
 * no linked servers to an empty set, so it is not a tool signal (same as disabled).
 */
export function hasMcpToolSignals(assistant: Pick<Assistant, 'settings' | 'mcpServerIds'>): boolean {
  const mode = assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE
  if (mode === 'auto') return true
  return mode === 'manual' && (assistant.mcpServerIds?.length ?? 0) > 0
}
