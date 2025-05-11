import type { ExternalToolResult, GenerateImageResponse, MCPToolResponse, WebSearchResponse } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { Response } from '@renderer/types/newMessage'
import { AssistantMessageStatus } from '@renderer/types/newMessage'

// Define the structure for the callbacks that the StreamProcessor will invoke
export interface StreamProcessorCallbacks {
  // LLM response created
  onLLMResponseCreated?: () => void
  // Text content chunk received
  onTextChunk?: (text: string) => void
  // Full text content received
  onTextComplete?: (text: string) => void
  // Thinking/reasoning content chunk received (e.g., from Claude)
  onThinkingChunk?: (text: string, thinking_millsec?: number) => void
  onThinkingComplete?: (text: string, thinking_millsec?: number) => void
  // A tool call response chunk (from MCP)
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
  onImageGenerated?: (imageData: GenerateImageResponse) => void
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
      // Logger.log(`[${new Date().toLocaleString()}] createStreamProcessor ${chunk.type}`, chunk)
      // 1. Handle the manual final signal first
      if (chunk?.type === ChunkType.BLOCK_COMPLETE) {
        callbacks.onComplete?.(AssistantMessageStatus.SUCCESS, chunk?.response)
        return
      }
      // 2. Process the actual ChunkCallbackData
      const data = chunk // Cast after checking for 'final'
      // Invoke callbacks based on the fields present in the chunk data
      if (data.type === ChunkType.LLM_RESPONSE_CREATED && callbacks.onLLMResponseCreated) {
        callbacks.onLLMResponseCreated()
      }
      if (data.type === ChunkType.TEXT_DELTA && callbacks.onTextChunk) {
        callbacks.onTextChunk(data.text)
      }
      if (data.type === ChunkType.TEXT_COMPLETE && callbacks.onTextComplete) {
        callbacks.onTextComplete(data.text)
      }
      if (data.type === ChunkType.THINKING_DELTA && callbacks.onThinkingChunk) {
        callbacks.onThinkingChunk(data.text)
      }
      if (data.type === ChunkType.THINKING_COMPLETE && callbacks.onThinkingComplete) {
        callbacks.onThinkingComplete(data.text, data.thinking_millsec)
      }
      if (data.type === ChunkType.MCP_TOOL_IN_PROGRESS && callbacks.onToolCallInProgress) {
        data.responses.forEach((toolResp) => callbacks.onToolCallInProgress!(toolResp))
      }
      if (data.type === ChunkType.MCP_TOOL_COMPLETE && data.responses.length > 0 && callbacks.onToolCallComplete) {
        data.responses.forEach((toolResp) => callbacks.onToolCallComplete!(toolResp))
      }
      if (data.type === ChunkType.EXTERNEL_TOOL_IN_PROGRESS && callbacks.onExternalToolInProgress) {
        callbacks.onExternalToolInProgress()
      }
      if (data.type === ChunkType.EXTERNEL_TOOL_COMPLETE && callbacks.onExternalToolComplete) {
        callbacks.onExternalToolComplete(data.external_tool)
      }
      if (data.type === ChunkType.LLM_WEB_SEARCH_IN_PROGRESS && callbacks.onLLMWebSearchInProgress) {
        callbacks.onLLMWebSearchInProgress()
      }
      if (data.type === ChunkType.LLM_WEB_SEARCH_COMPLETE && callbacks.onLLMWebSearchComplete) {
        callbacks.onLLMWebSearchComplete(data.llm_web_search)
      }
      if (data.type === ChunkType.IMAGE_CREATED && callbacks.onImageCreated) {
        callbacks.onImageCreated()
      }
      if (data.type === ChunkType.IMAGE_COMPLETE && callbacks.onImageGenerated) {
        callbacks.onImageGenerated(data.image)
      }
      // Note: Usage and Metrics are usually handled at the end or accumulated differently,
      // so direct callbacks might not be the best fit here. They are often part of the final message state.
    } catch (error) {
      console.error('Error processing stream chunk:', error)
      callbacks.onError?.(error)
    }
  }
}
