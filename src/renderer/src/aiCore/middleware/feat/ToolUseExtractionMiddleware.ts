import { MCPTool } from '@renderer/types'
import { ChunkType, MCPToolCreatedChunk, TextDeltaChunk } from '@renderer/types/chunk'
import { parseToolUse } from '@renderer/utils/mcp-tools'
import { TagConfig, TagExtractor } from '@renderer/utils/tagExtraction'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../schemas'
import { CompletionsContext, CompletionsMiddleware } from '../types'

export const MIDDLEWARE_NAME = 'ToolUseExtractionMiddleware'

// 工具使用标签配置
const TOOL_USE_TAG_CONFIG: TagConfig = {
  openingTag: '<tool_use>',
  closingTag: '</tool_use>',
  separator: '\n'
}

/**
 * 工具使用提取中间件
 *
 * 职责：
 * 1. 从文本流中检测并提取 <tool_use></tool_use> 标签
 * 2. 解析工具调用信息并转换为 ToolUseResponse 格式
 * 3. 生成 MCP_TOOL_CREATED chunk 供 McpToolChunkMiddleware 处理
 * 4. 清理文本流，移除工具使用标签但保留正常文本
 *
 * 注意：此中间件只负责提取和转换，实际工具调用由 McpToolChunkMiddleware 处理
 */
export const ToolUseExtractionMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const mcpTools = params.mcpTools || []

    // 如果没有工具，直接调用下一个中间件
    if (!mcpTools || mcpTools.length === 0) return next(ctx, params)

    // 调用下游中间件
    const result = await next(ctx, params)

    // 响应后处理：处理工具使用标签提取
    if (result.stream) {
      const resultFromUpstream = result.stream as ReadableStream<GenericChunk>

      const processedStream = resultFromUpstream.pipeThrough(createToolUseExtractionTransform(ctx, mcpTools))

      return {
        ...result,
        stream: processedStream
      }
    }

    return result
  }

/**
 * 创建工具使用提取的 TransformStream
 */
function createToolUseExtractionTransform(
  _ctx: CompletionsContext,
  mcpTools: MCPTool[]
): TransformStream<GenericChunk, GenericChunk> {
  const tagExtractor = new TagExtractor(TOOL_USE_TAG_CONFIG)

  return new TransformStream({
    async transform(chunk: GenericChunk, controller) {
      try {
        // 处理文本内容，检测工具使用标签
        if (chunk.type === ChunkType.TEXT_DELTA) {
          const textChunk = chunk as TextDeltaChunk
          const extractionResults = tagExtractor.processText(textChunk.text)

          for (const result of extractionResults) {
            if (result.complete && result.tagContentExtracted) {
              // 提取到完整的工具使用内容，解析并转换为 SDK ToolCall 格式
              const toolUseResponses = parseToolUse(result.tagContentExtracted, mcpTools)

              if (toolUseResponses.length > 0) {
                // 生成 MCP_TOOL_CREATED chunk，复用现有的处理流程
                const mcpToolCreatedChunk: MCPToolCreatedChunk = {
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_use_responses: toolUseResponses
                }
                controller.enqueue(mcpToolCreatedChunk)
              }
            } else if (!result.isTagContent && result.content) {
              // 发送标签外的正常文本内容
              const cleanTextChunk: TextDeltaChunk = {
                ...textChunk,
                text: result.content
              }
              controller.enqueue(cleanTextChunk)
            }
            // 注意：标签内的内容不会作为TEXT_DELTA转发，避免重复显示
          }
          return
        }

        // 转发其他所有chunk
        controller.enqueue(chunk)
      } catch (error) {
        console.error(`🔧 [${MIDDLEWARE_NAME}] Error processing chunk:`, error)
        controller.error(error)
      }
    },

    async flush(controller) {
      // 检查是否有未完成的标签内容
      const finalResult = tagExtractor.finalize()
      if (finalResult && finalResult.tagContentExtracted) {
        const toolUseResponses = parseToolUse(finalResult.tagContentExtracted, mcpTools)
        if (toolUseResponses.length > 0) {
          const mcpToolCreatedChunk: MCPToolCreatedChunk = {
            type: ChunkType.MCP_TOOL_CREATED,
            tool_use_responses: toolUseResponses
          }
          controller.enqueue(mcpToolCreatedChunk)
        }
      }
    }
  })
}

export default ToolUseExtractionMiddleware
