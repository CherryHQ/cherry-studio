import type { Tool } from '@renderer/types'

const PRESERVED_OPAQUE_TOOL_ID = 'PowerShell'

export const sanitizeAllowedToolIds = (toolIds: string[], availableTools: Tool[]): string[] => {
  const availableToolIds = new Set(availableTools.map((tool) => tool.id))
  return toolIds.filter((id) => id === PRESERVED_OPAQUE_TOOL_ID || availableToolIds.has(id))
}
