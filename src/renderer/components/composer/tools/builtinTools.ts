import attachmentTool from './definitions/attachmentTool'
import generateImageTool from './definitions/generateImageTool'
import knowledgeBaseTool from './definitions/knowledgeBaseTool'
import mcpStatusTool from './definitions/mcpStatusTool'
import permissionModeTool from './definitions/permissionModeTool'
import quickPhrasesTool from './definitions/quickPhrasesTool'
import slashCommandsTool from './definitions/slashCommandsTool'
import thinkingTool from './definitions/thinkingTool'
import urlContextTool from './definitions/urlContextTool'
import webSearchTool from './definitions/webSearchTool'
import type { ComposerToolScope, ToolContext, ToolDefinition } from './types'

/**
 * The complete, explicit set of composer tools. Listing them here — instead of
 * having each definition self-register via an `import`-for-side-effect — makes the
 * tool set deterministic and tree-shake-safe: a tool exists iff it appears in this
 * array. Order is the display order surfaced by `getAllTools`.
 */
export const BUILTIN_COMPOSER_TOOLS: ToolDefinition<any, any>[] = [
  attachmentTool,
  quickPhrasesTool,
  thinkingTool,
  webSearchTool,
  urlContextTool,
  knowledgeBaseTool,
  generateImageTool,
  slashCommandsTool,
  permissionModeTool,
  mcpStatusTool
]

export const getAllTools = (): ToolDefinition<any, any>[] => BUILTIN_COMPOSER_TOOLS

export const getTool = (key: string): ToolDefinition<any, any> | undefined =>
  BUILTIN_COMPOSER_TOOLS.find((tool) => tool.key === key)

export const getToolsForScope = (
  scope: ComposerToolScope,
  context: Omit<ToolContext, 'scope'>
): ToolDefinition<any, any>[] => {
  const fullContext: ToolContext = { ...context, scope }

  return BUILTIN_COMPOSER_TOOLS.filter((tool) => {
    // Check scope visibility
    if (tool.visibleInScopes && !tool.visibleInScopes.includes(scope)) {
      return false
    }

    // Check custom condition
    if (tool.condition && !tool.condition(fullContext)) {
      return false
    }

    return true
  })
}
