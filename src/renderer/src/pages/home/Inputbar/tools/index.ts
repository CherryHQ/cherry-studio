// Tool registry loader
// Import all tool definitions to register them

import './attachmentTool'
import './mentionModelsTool'
import './newTopicTool'
import './quickPhrasesTool'
import './thinkingTool'
import './webSearchTool'
import './urlContextTool'
import './knowledgeBaseTool'
import './mcpToolsTool'
import './generateImageTool'
import './clearTopicTool'
import './toggleExpandTool'
import './newContextTool'

// Export registry functions
export { getAllTools, getDefaultToolOrder, getTool, getToolsForScope, registerTool } from '../types'
