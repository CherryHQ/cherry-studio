import type { Tool } from '@modelcontextprotocol/client'
import { McpUiToolMetaSchema } from '@modelcontextprotocol/ext-apps/app-bridge'

export type McpToolAudience = 'model' | 'app'

export function isMcpToolVisibleTo(tool: Pick<Tool, '_meta'>, audience: McpToolAudience): boolean {
  const ui = tool._meta?.ui
  if (ui === undefined) return true
  const parsed = McpUiToolMetaSchema.safeParse(ui)
  return parsed.success && (parsed.data.visibility?.includes(audience) ?? true)
}
