// Wraps the desktop composer tools: the Web edition has no attachments, dictation, web search,
// knowledge bases, image generation, MCP or notes, so their tools are left out of every composer.
import { BUILTIN_COMPOSER_TOOLS as DESKTOP_TOOLS } from '@renderer/components/composer/tools/builtinTools'
import type { ComposerToolScope, ToolContext, ToolDefinition } from '@renderer/components/composer/tools/types'

const webTools = new Set(['quick_phrases', 'slash_commands', 'permission_mode'])

export const BUILTIN_COMPOSER_TOOLS: ToolDefinition<any, any>[] = DESKTOP_TOOLS.filter(({ key }) => webTools.has(key))

export const getAllTools = (): ToolDefinition<any, any>[] => BUILTIN_COMPOSER_TOOLS

export const getTool = (key: string): ToolDefinition<any, any> | undefined =>
  BUILTIN_COMPOSER_TOOLS.find((tool) => tool.key === key)

export const getToolsForScope = (
  scope: ComposerToolScope,
  context: Omit<ToolContext, 'scope'>
): ToolDefinition<any, any>[] => {
  const fullContext: ToolContext = { ...context, scope }
  return BUILTIN_COMPOSER_TOOLS.filter(
    (tool) =>
      (!tool.visibleInScopes || tool.visibleInScopes.includes(scope)) &&
      (!tool.condition || tool.condition(fullContext))
  )
}
