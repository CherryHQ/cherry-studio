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
 * 4. 丢弃 tool_use 之后的所有内容（助手幻觉）
 * 5. 清理文本流，移除工具使用标签但保留正常文本
 *
 * 注意：此中间件只负责提取和转换，实际工具调用由 McpToolChunkMiddleware 处理
 */
export const ToolUseExtractionMiddleware: CompletionsMiddleware =
  () =>
  (next) =>
  async (ctx: CompletionsContext, params: CompletionsParams): Promise<CompletionsResult> => {
    const mcpTools = params.mcpTools || []

    if (!mcpTools || mcpTools.length === 0) return next(ctx, params)

    const result = await next(ctx, params)

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
  const toolUseExtractor = new TagExtractor(TOOL_USE_TAG_CONFIG)
  let hasAnyToolUse = false
  let toolCounter = 0

  return new TransformStream({
    async transform(chunk: GenericChunk, controller) {
      try {
        // 处理文本内容，检测工具使用标签
        if (chunk.type === ChunkType.TEXT_DELTA) {
          const textChunk = chunk as TextDeltaChunk

          // 处理 tool_use 标签
          const toolUseResults = toolUseExtractor.processText(textChunk.text)

          for (const result of toolUseResults) {
            if (result.complete && result.tagContentExtracted) {
              // 提取到完整的工具使用内容，解析并转换为 SDK ToolCall 格式
              const toolUseResponses = parseToolUse(result.tagContentExtracted, mcpTools, toolCounter)
              toolCounter += toolUseResponses.length

              if (toolUseResponses.length > 0) {
                // 生成 MCP_TOOL_CREATED chunk
                const mcpToolCreatedChunk: MCPToolCreatedChunk = {
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_use_responses: toolUseResponses
                }
                controller.enqueue(mcpToolCreatedChunk)

                // 标记已有工具调用
                hasAnyToolUse = true
              }
            } else if (!result.isTagContent && result.content) {
              if (!hasAnyToolUse) {
                const cleanTextChunk: TextDeltaChunk = {
                  ...textChunk,
                  text: result.content
                }
                controller.enqueue(cleanTextChunk)
              }
            }
            // tool_use 标签内的内容不转发，避免重复显示
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
      // 检查是否有未完成的 tool_use 标签内容
      const finalToolUseResult = toolUseExtractor.finalize()
      if (finalToolUseResult && finalToolUseResult.tagContentExtracted) {
        const toolUseResponses = parseToolUse(finalToolUseResult.tagContentExtracted, mcpTools, toolCounter)
        if (toolUseResponses.length > 0) {
          const mcpToolCreatedChunk: MCPToolCreatedChunk = {
            type: ChunkType.MCP_TOOL_CREATED,
            tool_use_responses: toolUseResponses
          }
          controller.enqueue(mcpToolCreatedChunk)
          hasAnyToolUse = true
        }
      }
    }
  })
}

export default ToolUseExtractionMiddleware
