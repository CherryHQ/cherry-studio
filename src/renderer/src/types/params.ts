import type { CompletionUsage } from 'openai/resources'

import type { Assistant } from './assistant'
import type { FileMetadata } from './file'
import type { MCPServer } from './mcp'
import type { Model } from './model'
import type { Topic } from './topic'

export interface MessageInputBaseParams {
  assistant: Assistant
  topic: Topic
  content?: string
  files?: FileMetadata[]
  knowledgeBaseIds?: string[]
  mentions?: Model[]
  /**
   * @deprecated
   */
  enabledMCPs?: MCPServer[]
  usage?: CompletionUsage
}
