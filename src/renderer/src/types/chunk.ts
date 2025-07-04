import { ExternalToolResult, KnowledgeReference, MCPToolResponse, ToolUseResponse, WebSearchResponse } from '.'
import { Response, ResponseError } from './newMessage'
import { SdkToolCall } from './sdk'

// Define Enum for Chunk Types
// 目前用到的，并没有列出完整的生命周期
export enum ChunkType {
  BLOCK_CREATED = 'block_created',
  BLOCK_IN_PROGRESS = 'block_in_progress',
  EXTERNEL_TOOL_IN_PROGRESS = 'externel_tool_in_progress',
  WEB_SEARCH_IN_PROGRESS = 'web_search_in_progress',
  WEB_SEARCH_COMPLETE = 'web_search_complete',
  KNOWLEDGE_SEARCH_IN_PROGRESS = 'knowledge_search_in_progress',
  KNOWLEDGE_SEARCH_COMPLETE = 'knowledge_search_complete',
  MCP_TOOL_CREATED = 'mcp_tool_created',
  MCP_TOOL_PENDING = 'mcp_tool_pending',
  MCP_TOOL_IN_PROGRESS = 'mcp_tool_in_progress',
  MCP_TOOL_COMPLETE = 'mcp_tool_complete',
  EXTERNEL_TOOL_COMPLETE = 'externel_tool_complete',
  LLM_RESPONSE_CREATED = 'llm_response_created',
  LLM_RESPONSE_IN_PROGRESS = 'llm_response_in_progress',
  TEXT_DELTA = 'text.delta',
  TEXT_COMPLETE = 'text.complete',
  AUDIO_DELTA = 'audio.delta',
  AUDIO_COMPLETE = 'audio.complete',
  IMAGE_CREATED = 'image.created',
  IMAGE_DELTA = 'image.delta',
  IMAGE_COMPLETE = 'image.complete',
  THINKING_DELTA = 'thinking.delta',
  THINKING_COMPLETE = 'thinking.complete',
  LLM_WEB_SEARCH_IN_PROGRESS = 'llm_websearch_in_progress',
  LLM_WEB_SEARCH_COMPLETE = 'llm_websearch_complete',
  LLM_RESPONSE_COMPLETE = 'llm_response_complete',
  BLOCK_COMPLETE = 'block_complete',
  ERROR = 'error',
  SEARCH_IN_PROGRESS_UNION = 'search_in_progress_union',
  SEARCH_COMPLETE_UNION = 'search_complete_union'
}

export interface LLMResponseCreatedChunk {
  /**
   * The response
   */
  response?: Response

  /**
   * The type of the chunk
   */
  type: ChunkType.LLM_RESPONSE_CREATED
}

export interface LLMResponseInProgressChunk {
  /**
   * The type of the chunk
   */
  response?: Response
  type: ChunkType.LLM_RESPONSE_IN_PROGRESS
}
export interface TextDeltaChunk {
  /**
   * The text content of the chunk
   */
  text: string

  /**
   * The ID of the chunk
   */
  chunk_id?: number

  /**
   * The type of the chunk
   */
  type: ChunkType.TEXT_DELTA
}

export interface TextCompleteChunk {
  /**
   * The text content of the chunk
   */
  text: string

  /**
   * The ID of the chunk
   */
  chunk_id?: number

  /**
   * The type of the chunk
   */
  type: ChunkType.TEXT_COMPLETE
}

export interface AudioDeltaChunk {
  /**
   * A chunk of Base64 encoded audio data
   */
  audio: string

  /**
   * The type of the chunk
   */
  type: ChunkType.AUDIO_DELTA
}

export interface AudioCompleteChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.AUDIO_COMPLETE
}

export interface ImageCreatedChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.IMAGE_CREATED
}

export interface ImageDeltaChunk {
  /**
   * A chunk of Base64 encoded image data
   */
  image: { type: 'base64'; images: string[] }

  /**
   * The type of the chunk
   */
  type: ChunkType.IMAGE_DELTA
}

export interface ImageCompleteChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.IMAGE_COMPLETE

  /**
   * The image content of the chunk
   */
  image?: { type: 'url' | 'base64'; images: string[] }
}

export interface ThinkingDeltaChunk {
  /**
   * The text content of the chunk
   */
  text: string

  /**
   * The thinking time of the chunk
   */
  thinking_millsec?: number

  /**
   * The type of the chunk
   */
  type: ChunkType.THINKING_DELTA
}

export interface ThinkingCompleteChunk {
  /**
   * The text content of the chunk
   */
  text: string

  /**
   * The thinking time of the chunk
   */
  thinking_millsec?: number

  /**
   * The type of the chunk
   */
  type: ChunkType.THINKING_COMPLETE
}

export interface WebSearchInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.WEB_SEARCH_IN_PROGRESS
}

export interface WebSearchCompleteChunk {
  /**
   * The web search response of the chunk
   */
  web_search: WebSearchResponse

  /**
   * The ID of the chunk
   */
  chunk_id?: number

  /**
   * The type of the chunk
   */
  type: ChunkType.WEB_SEARCH_COMPLETE
}

// 区分一下大模型内部搜索和外部搜索，因为时机不同
export interface LLMWebSearchInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
}

export interface LLMWebSearchCompleteChunk {
  /**
   * The LLM web search response of the chunk
   */
  llm_web_search: WebSearchResponse

  /**
   * The type of the chunk
   */
  type: ChunkType.LLM_WEB_SEARCH_COMPLETE
}

export interface KnowledgeSearchInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.KNOWLEDGE_SEARCH_IN_PROGRESS
}

export interface KnowledgeSearchCompleteChunk {
  /**
   * The knowledge search response of the chunk
   */
  knowledge: KnowledgeReference[]

  /**
   * The type of the chunk
   */
  type: ChunkType.KNOWLEDGE_SEARCH_COMPLETE
}

export interface ExternalToolInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS
}

export interface ExternalToolCompleteChunk {
  /**
   * The external tool result of the chunk
   */
  external_tool: ExternalToolResult
  /**
   * The type of the chunk
   */
  type: ChunkType.EXTERNEL_TOOL_COMPLETE
}

export interface MCPToolCreatedChunk {
  type: ChunkType.MCP_TOOL_CREATED
  tool_calls?: SdkToolCall[] // 工具调用
  tool_use_responses?: ToolUseResponse[] // 工具使用响应
}

export interface MCPToolPendingChunk {
  type: ChunkType.MCP_TOOL_PENDING
  responses: MCPToolResponse[]
}

export interface MCPToolInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.MCP_TOOL_IN_PROGRESS
  /**
   * The tool responses of the chunk
   */
  responses: MCPToolResponse[]
}

export interface MCPToolCompleteChunk {
  /**
   * The tool response of the chunk
   */
  responses: MCPToolResponse[]

  /**
   * The type of the chunk
   */
  type: ChunkType.MCP_TOOL_COMPLETE
}

export interface LLMResponseCompleteChunk {
  /**
   * The response
   */
  response?: Response

  /**
   * The type of the chunk
   */
  type: ChunkType.LLM_RESPONSE_COMPLETE
}
export interface ErrorChunk {
  error: ResponseError

  type: ChunkType.ERROR
}

export interface BlockCreatedChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.BLOCK_CREATED
}

export interface BlockInProgressChunk {
  /**
   * The type of the chunk
   */
  type: ChunkType.BLOCK_IN_PROGRESS

  /**
   * The response
   */
  response?: Response
}

export interface BlockCompleteChunk {
  /**
   * The full response
   */
  response?: Response

  /**
   * The type of the chunk
   */
  type: ChunkType.BLOCK_COMPLETE

  /**
   * The error
   */
  error?: ResponseError
}

export interface SearchInProgressUnionChunk {
  type: ChunkType.SEARCH_IN_PROGRESS_UNION
}

export interface SearchCompleteUnionChunk {
  type: ChunkType.SEARCH_COMPLETE_UNION
}

export type Chunk =
  | BlockCreatedChunk // 消息块创建，无意义
  | BlockInProgressChunk // 消息块进行中，无意义
  | ExternalToolInProgressChunk // 外部工具调用中
  | WebSearchInProgressChunk // 互联网搜索进行中
  | WebSearchCompleteChunk // 互联网搜索完成
  | KnowledgeSearchInProgressChunk // 知识库搜索进行中
  | KnowledgeSearchCompleteChunk // 知识库搜索完成
  | MCPToolCreatedChunk // MCP工具被大模型创建
  | MCPToolPendingChunk // MCP工具调用等待中
  | MCPToolInProgressChunk // MCP工具调用中
  | MCPToolCompleteChunk // MCP工具调用完成
  | ExternalToolCompleteChunk // 外部工具调用完成，外部工具包含搜索互联网，知识库，MCP服务器
  | LLMResponseCreatedChunk // 大模型响应创建，返回即将创建的块类型
  | LLMResponseInProgressChunk // 大模型响应进行中
  | TextDeltaChunk // 文本内容生成中
  | TextCompleteChunk // 文本内容生成完成
  | AudioDeltaChunk // 音频内容生成中
  | AudioCompleteChunk // 音频内容生成完成
  | ImageCreatedChunk // 图片内容创建
  | ImageDeltaChunk // 图片内容生成中
  | ImageCompleteChunk // 图片内容生成完成
  | ThinkingDeltaChunk // 思考内容生成中
  | ThinkingCompleteChunk // 思考内容生成完成
  | LLMWebSearchInProgressChunk // 大模型内部搜索进行中，无明显特征
  | LLMWebSearchCompleteChunk // 大模型内部搜索完成
  | LLMResponseCompleteChunk // 大模型响应完成，未来用于作为流式处理的完成标记
  | BlockCompleteChunk // 所有块创建完成，通常用于非流式处理；目前没有做区分
  | ErrorChunk // 错误
  | SearchInProgressUnionChunk // 搜索(知识库/互联网)进行中
  | SearchCompleteUnionChunk // 搜索(知识库/互联网)完成
