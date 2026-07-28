import type { Assistant, McpMode } from '@renderer/types/assistant'

/**
 * Get the effective MCP mode for an assistant with backward compatibility.
 * v2 keeps `mcpMode` inside `settings` and supplies a default — this helper
 * stays as a thin facade so existing callers don't have to change.
 */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  return assistant.settings?.mcpMode ?? 'disabled'
}
