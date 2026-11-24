import attachmentTool from './definitions/attachmentTool'
import dictationTool from './definitions/dictationTool'
import generateImageTool from './definitions/generateImageTool'
import knowledgeBaseTool from './definitions/knowledgeBaseTool'
import mcpPromptTool from './definitions/mcpPromptTool'
import mcpResourceTool from './definitions/mcpResourceTool'
import mcpStatusTool from './definitions/mcpStatusTool'
import noteReferenceTool from './definitions/noteReferenceTool'
import permissionModeTool from './definitions/permissionModeTool'
import quickPhrasesTool from './definitions/quickPhrasesTool'
import slashCommandsTool from './definitions/slashCommandsTool'
import webSearchTool from './definitions/webSearchTool'
import type { ComposerToolRegistration, ComposerToolScope, ToolContext } from './types'

/**
 * The complete, explicit set of composer tools. Listing them here — instead of
 * having each definition self-register via an `import`-for-side-effect — makes the
 * tool set deterministic and tree-shake-safe: a tool exists iff it appears in this
 * array. Order is the display order surfaced by `getAllTools`.
 */
export const BUILTIN_COMPOSER_TOOLS: ComposerToolRegistration[] = [
  attachmentTool,
  dictationTool,
  quickPhrasesTool,
  webSearchTool,
  knowledgeBaseTool,
  generateImageTool,
  slashCommandsTool,
  permissionModeTool,
  mcpStatusTool,
  mcpPromptTool,
  mcpResourceTool,
  noteReferenceTool
]

export const getAllTools = (): ComposerToolRegistration[] => BUILTIN_COMPOSER_TOOLS

export const getToolsForScope = (
  scope: ComposerToolScope,
  context: Omit<ToolContext, 'scope'>
): ComposerToolRegistration[] => {
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
