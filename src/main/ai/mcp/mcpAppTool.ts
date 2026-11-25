import type { Tool } from '@modelcontextprotocol/client'
import { McpUiToolMetaSchema } from '@modelcontextprotocol/ext-apps/app-bridge'

export type McpToolAudience = 'model' | 'app'

export function isMcpToolVisibleTo(tool: Pick<Tool, '_meta'>, audience: McpToolAudience): boolean {
  const ui = tool._meta?.ui
  if (ui === undefined) return true
  const parsed = McpUiToolMetaSchema.safeParse(ui)
  return parsed.success && (parsed.data.visibility?.includes(audience) ?? true)
}

export function getMcpAppResourceUri(tool: Pick<Tool, '_meta'>): string | undefined {
  const parsed = McpUiToolMetaSchema.safeParse(tool._meta?.ui)
  const uri = parsed.success ? parsed.data.resourceUri : undefined
  return uri?.startsWith('ui://') && uri.length <= 8192 ? uri : undefined
}
