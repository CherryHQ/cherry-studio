// Tool registry loader
// Import all tool definitions to register them

import './definitions/attachmentTool'
import './definitions/quickPhrasesTool'
import './definitions/thinkingTool'
import './definitions/webSearchTool'
import './definitions/knowledgeBaseTool'
import './definitions/generateImageTool'
import './definitions/slashCommandsTool'
import './definitions/permissionModeTool'
import './definitions/mcpStatusTool'

// Export registry functions
export { getAllTools, getToolsForScope, registerTool } from './types'
