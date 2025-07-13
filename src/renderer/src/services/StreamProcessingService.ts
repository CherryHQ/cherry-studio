import type { ExternalToolResult, GenerateImageResponse, MCPToolResponse, WebSearchResponse } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { Response } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'

// Define the structure for the callbacks that the StreamProcessor will invoke
export interface StreamProcessorCallbacks {
  // LLM response created
  onLLMResponseCreated?: () => void
  // Text content start
  onTextStart?: () => void
  // Text content chunk received
  onTextChunk?: (text: string) => void
  // Full text content received
  onTextComplete?: (text: string) => void
  // thinking content start
  onThinkingStart?: () => void
  // Thinking/reasoning content chunk received (e.g., from Claude)
  onThinkingChunk?: (text: string, thinking_millsec?: number) => void
  onThinkingComplete?: (text: string, thinking_millsec?: number) => void
  // A tool call response chunk (from MCP)
  onToolCallPending?: (toolResponse: MCPToolResponse) => void
  onToolCallInProgress?: (toolResponse: MCPToolResponse) => void
  onToolCallComplete?: (toolResponse: MCPToolResponse) => void
  // External tool call in progress
  onExternalToolInProgress?: () => void
  // Citation data received (e.g., from Internet and  Knowledge Base)
  onExternalToolComplete?: (externalToolResult: ExternalToolResult) => void
  // LLM Web search in progress
  onLLMWebSearchInProgress?: () => void
  // LLM Web search complete
  onLLMWebSearchComplete?: (llmWebSearchResult: WebSearchResponse) => void
  // Image generation chunk received
  onImageCreated?: () => void
  onImageDelta?: (imageData: GenerateImageResponse) => void
  onImageGenerated?: (imageData?: GenerateImageResponse) => void
  onLLMResponseComplete?: (response?: Response) => void
  // Called when an error occurs during chunk processing
  onError?: (error: any) => void
  // Called when the entire stream processing is signaled as complete (success or failure)
  onComplete?: (status: AssistantMessageStatus, response?: Response) => void
}

// Function to create a stream processor instance
export function createStreamProcessor(callbacks: StreamProcessorCallbacks = {}) {
  // The returned function processes a single chunk or a final signal
  return (chunk: Chunk) => {
    try {
      const data = chunk
      // console.log('data: ', chunk)
      switch (data.type) {
        case ChunkType.BLOCK_COMPLETE: {
          if (callbacks.onComplete) callbacks.onComplete(AssistantMessageStatus.SUCCESS, data?.response)
          break
        }
        case ChunkType.LLM_RESPONSE_CREATED: {
          if (callbacks.onLLMResponseCreated) callbacks.onLLMResponseCreated()
          break
        }
        case ChunkType.TEXT_START: {
          if (callbacks.onTextStart) callbacks.onTextStart()
          break
        }
        case ChunkType.TEXT_DELTA: {
          if (callbacks.onTextChunk) callbacks.onTextChunk(data.text)
          break
        }
        case ChunkType.TEXT_COMPLETE: {
          if (callbacks.onTextComplete) callbacks.onTextComplete(data.text)
          break
        }
        case ChunkType.THINKING_START: {
          if (callbacks.onThinkingStart) callbacks.onThinkingStart()
          break
        }
        case ChunkType.THINKING_DELTA: {
          if (callbacks.onThinkingChunk) callbacks.onThinkingChunk(data.text, data.thinking_millsec)
          break
        }
        case ChunkType.THINKING_COMPLETE: {
          if (callbacks.onThinkingComplete) callbacks.onThinkingComplete(data.text, data.thinking_millsec)
          break
        }
        case ChunkType.MCP_TOOL_PENDING: {
          if (callbacks.onToolCallPending) data.responses.forEach((toolResp) => callbacks.onToolCallPending!(toolResp))
          break
        }
        case ChunkType.MCP_TOOL_IN_PROGRESS: {
          if (callbacks.onToolCallInProgress)
            data.responses.forEach((toolResp) => callbacks.onToolCallInProgress!(toolResp))
          break
        }
        case ChunkType.MCP_TOOL_COMPLETE: {
          if (callbacks.onToolCallComplete && data.responses.length > 0) {
            data.responses.forEach((toolResp) => callbacks.onToolCallComplete!(toolResp))
          }
          break
        }
        case ChunkType.EXTERNEL_TOOL_IN_PROGRESS: {
          if (callbacks.onExternalToolInProgress) callbacks.onExternalToolInProgress()
          break
        }
        case ChunkType.EXTERNEL_TOOL_COMPLETE: {
          if (callbacks.onExternalToolComplete) callbacks.onExternalToolComplete(data.external_tool)
          break
        }
        case ChunkType.LLM_WEB_SEARCH_IN_PROGRESS: {
          if (callbacks.onLLMWebSearchInProgress) callbacks.onLLMWebSearchInProgress()
          break
        }
        case ChunkType.LLM_WEB_SEARCH_COMPLETE: {
          if (callbacks.onLLMWebSearchComplete) callbacks.onLLMWebSearchComplete(data.llm_web_search)
          break
        }
        case ChunkType.IMAGE_CREATED: {
          if (callbacks.onImageCreated) callbacks.onImageCreated()
          break
        }
        case ChunkType.IMAGE_DELTA: {
          if (callbacks.onImageDelta) callbacks.onImageDelta(data.image)
          break
        }
        case ChunkType.IMAGE_COMPLETE: {
          if (callbacks.onImageGenerated) callbacks.onImageGenerated(data.image)
          break
        }
        case ChunkType.LLM_RESPONSE_COMPLETE: {
          if (callbacks.onLLMResponseComplete) callbacks.onLLMResponseComplete(data.response)
          break
        }
        case ChunkType.ERROR: {
          if (callbacks.onError) callbacks.onError(data.error)
          break
        }
        default: {
          // Handle unknown chunk types or log an error
          console.warn(`Unknown chunk type: ${data.type}`)
        }
      }
    } catch (error) {
      console.error('Error processing stream chunk:', error)
      callbacks.onError?.(error)
    }
  }
}
