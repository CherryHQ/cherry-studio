/**
 * 工具调用 Chunk 处理模块
 * TODO: Tool包含了providerTool和普通的Tool还有MCPTool,后面需要重构
 * 提供工具调用相关的处理API，每个交互使用一个新的实例
 */

import { loggerService } from '@logger'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { BaseTool, MCPTool, MCPToolResponse, NormalToolResponse } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { ProviderMetadata, ToolSet, TypedToolCall, TypedToolError, TypedToolResult } from 'ai'

const logger = loggerService.withContext('ToolCallChunkHandler')

export type ToolcallsMap = {
  toolCallId: string
  toolName: string
  args: any
  // mcpTool 现在可以是 MCPTool 或我们为 Provider 工具创建的通用类型
  tool: BaseTool
  // Streaming arguments buffer
  streamingArgs?: string
}
/**
 * 工具调用处理器类
 */
export class ToolCallChunkHandler {
  private static globalActiveToolCalls = new Map<string, ToolcallsMap>()

  private activeToolCalls = ToolCallChunkHandler.globalActiveToolCalls
  constructor(
    private onChunk: (chunk: Chunk) => void,
    private mcpTools: MCPTool[]
  ) {}

  /**
   * 内部静态方法：添加活跃工具调用的核心逻辑
   */
  private static addActiveToolCallImpl(toolCallId: string, map: ToolcallsMap): boolean {
    if (!ToolCallChunkHandler.globalActiveToolCalls.has(toolCallId)) {
      ToolCallChunkHandler.globalActiveToolCalls.set(toolCallId, map)
      return true
    }
    return false
  }

  /**
   * 实例方法：添加活跃工具调用
   */
  private addActiveToolCall(toolCallId: string, map: ToolcallsMap): boolean {
    return ToolCallChunkHandler.addActiveToolCallImpl(toolCallId, map)
  }

  /**
   * 获取全局活跃的工具调用
   */
  public static getActiveToolCalls() {
    return ToolCallChunkHandler.globalActiveToolCalls
  }

  /**
   * 静态方法：添加活跃工具调用（外部访问）
   */
  public static addActiveToolCall(toolCallId: string, map: ToolcallsMap): boolean {
    return ToolCallChunkHandler.addActiveToolCallImpl(toolCallId, map)
  }

  /**
   * 根据工具名称确定工具类型
   */
  private determineToolType(toolName: string, toolCallId: string): BaseTool {
    let mcpTool: MCPTool | undefined
    if (toolName.startsWith('builtin_')) {
      return {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'builtin'
      } as BaseTool
    } else if ((mcpTool = this.mcpTools.find((t) => t.id === toolName) as MCPTool)) {
      return mcpTool
    } else {
      return {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'provider'
      }
    }
  }

  /**
   * 处理工具输入开始事件 - 流式参数开始
   */
  public handleToolInputStart(chunk: {
    type: 'tool-input-start'
    id: string
    toolName: string
    providerMetadata?: ProviderMetadata
    providerExecuted?: boolean
  }): void {
    const { id: toolCallId, toolName, providerExecuted } = chunk

    if (!toolCallId || !toolName) {
      logger.warn(`🔧 [ToolCallChunkHandler] Invalid tool-input-start chunk: missing id or toolName`)
      return
    }

    // 如果已存在，跳过
    if (this.activeToolCalls.has(toolCallId)) {
      return
    }

    let tool: BaseTool
    if (providerExecuted) {
      tool = {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'provider'
      } as BaseTool
    } else {
      tool = this.determineToolType(toolName, toolCallId)
    }

    // 初始化流式工具调用
    this.addActiveToolCall(toolCallId, {
      toolCallId,
      toolName,
      args: undefined,
      tool,
      streamingArgs: ''
    })

    logger.info(`🔧 [ToolCallChunkHandler] Tool input streaming started: ${toolName} (${toolCallId})`)

    // 发送初始 streaming chunk
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallId,
      tool: tool,
      arguments: undefined,
      status: 'streaming',
      toolCallId: toolCallId,
      partialArguments: ''
    }

    this.onChunk({
      type: ChunkType.MCP_TOOL_STREAMING,
      responses: [toolResponse]
    })
  }

  /**
   * 处理工具输入增量事件 - 流式参数片段
   */
  public handleToolInputDelta(chunk: {
    type: 'tool-input-delta'
    id: string
    delta: string
    providerMetadata?: ProviderMetadata
  }): void {
    const { id: toolCallId, delta } = chunk

    const toolCall = this.activeToolCalls.get(toolCallId)
    if (!toolCall) {
      logger.warn(`🔧 [ToolCallChunkHandler] Tool call not found for delta: ${toolCallId}`)
      return
    }

    // 累积流式参数
    toolCall.streamingArgs = (toolCall.streamingArgs || '') + delta

    // 发送 streaming chunk 更新
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallId,
      tool: toolCall.tool,
      arguments: undefined,
      status: 'streaming',
      toolCallId: toolCallId,
      partialArguments: toolCall.streamingArgs
    }

    this.onChunk({
      type: ChunkType.MCP_TOOL_STREAMING,
      responses: [toolResponse]
    })
  }

  /**
   * 处理工具输入结束事件 - 流式参数完成
   */
  public handleToolInputEnd(chunk: { type: 'tool-input-end'; id: string; providerMetadata?: ProviderMetadata }): void {
    const { id: toolCallId } = chunk

    const toolCall = this.activeToolCalls.get(toolCallId)
    if (!toolCall) {
      logger.warn(`🔧 [ToolCallChunkHandler] Tool call not found for end: ${toolCallId}`)
      return
    }

    // 尝试解析完整的 JSON 参数
    let parsedArgs: any = undefined
    if (toolCall.streamingArgs) {
      try {
        parsedArgs = JSON.parse(toolCall.streamingArgs)
        toolCall.args = parsedArgs
      } catch (e) {
        logger.warn(`🔧 [ToolCallChunkHandler] Failed to parse streaming args for ${toolCallId}:`, e as Error)
        // 保留原始字符串
        toolCall.args = toolCall.streamingArgs
      }
    }

    logger.info(`🔧 [ToolCallChunkHandler] Tool input streaming completed: ${toolCall.toolName} (${toolCallId})`)

    // 发送 streaming 完成 chunk
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallId,
      tool: toolCall.tool,
      arguments: parsedArgs,
      status: 'pending',
      toolCallId: toolCallId,
      partialArguments: toolCall.streamingArgs
    }

    this.onChunk({
      type: ChunkType.MCP_TOOL_STREAMING,
      responses: [toolResponse]
    })
  }

  /**
   * 处理工具调用事件
   */
  public handleToolCall(
    chunk: {
      type: 'tool-call'
    } & TypedToolCall<ToolSet>
  ): void {
    const { toolCallId, toolName, input: args, providerExecuted } = chunk

    if (!toolCallId || !toolName) {
      logger.warn(`🔧 [ToolCallChunkHandler] Invalid tool call chunk: missing toolCallId or toolName`)
      return
    }

    // Check if this tool call was already processed via streaming events
    const existingToolCall = this.activeToolCalls.get(toolCallId)
    if (existingToolCall?.streamingArgs !== undefined) {
      // Tool call was already processed via streaming events (tool-input-start/delta/end)
      // Update args if needed, but don't emit duplicate pending chunk
      existingToolCall.args = args
      return
    }

    let tool: BaseTool
    let mcpTool: MCPTool | undefined
    // 根据 providerExecuted 标志区分处理逻辑
    if (providerExecuted) {
      // 如果是 Provider 执行的工具（如 web_search）
      logger.info(`[ToolCallChunkHandler] Handling provider-executed tool: ${toolName}`)
      tool = {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'provider'
      } as BaseTool
    } else if (toolName.startsWith('builtin_')) {
      // 如果是内置工具，沿用现有逻辑
      logger.info(`[ToolCallChunkHandler] Handling builtin tool: ${toolName}`)
      tool = {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'builtin'
      } as BaseTool
    } else if ((mcpTool = this.mcpTools.find((t) => t.id === toolName) as MCPTool)) {
      // 如果是客户端执行的 MCP 工具，沿用现有逻辑
      // toolName is mcpTool.id (registered with id as key in convertMcpToolsToAiSdkTools)
      logger.info(`[ToolCallChunkHandler] Handling client-side MCP tool: ${toolName}`)
      tool = mcpTool
    } else {
      tool = {
        id: toolCallId,
        name: toolName,
        description: toolName,
        type: 'provider'
      }
    }

    this.addActiveToolCall(toolCallId, {
      toolCallId,
      toolName,
      args,
      tool
    })
    // 创建 MCPToolResponse 格式
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallId,
      tool: tool,
      arguments: args,
      status: 'pending', // 统一使用 pending 状态
      toolCallId: toolCallId
    }

    // 调用 onChunk
    if (this.onChunk) {
      this.onChunk({
        type: ChunkType.MCP_TOOL_PENDING, // 统一发送 pending 状态
        responses: [toolResponse]
      })
    }
  }

  /**
   * 处理工具调用结果事件
   */
  public handleToolResult(
    chunk: {
      type: 'tool-result'
    } & TypedToolResult<ToolSet>
  ): void {
    // TODO: 基于AI SDK为供应商内置工具做更好的展示和类型安全处理
    const { toolCallId, output, input } = chunk

    if (!toolCallId) {
      logger.warn(`🔧 [ToolCallChunkHandler] Invalid tool result chunk: missing toolCallId`)
      return
    }

    // 查找对应的工具调用信息
    const toolCallInfo = this.activeToolCalls.get(toolCallId)
    if (!toolCallInfo) {
      logger.warn(`🔧 [ToolCallChunkHandler] Tool call info not found for ID: ${toolCallId}`)
      return
    }

    // 创建工具调用结果的 MCPToolResponse 格式
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallInfo.toolCallId,
      tool: toolCallInfo.tool,
      arguments: input,
      status: 'done',
      response: output,
      toolCallId: toolCallId
    }

    // 从活跃调用中移除（交互结束后整个实例会被丢弃）
    this.activeToolCalls.delete(toolCallId)

    // 调用 onChunk
    if (this.onChunk) {
      this.onChunk({
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [toolResponse]
      })

      const images = extractImagesFromToolOutput(toolResponse.response)

      if (images.length) {
        this.onChunk({
          type: ChunkType.IMAGE_CREATED
        })
        this.onChunk({
          type: ChunkType.IMAGE_COMPLETE,
          image: {
            type: 'base64',
            images: images
          }
        })
      }
    }
  }

  handleToolError(
    chunk: {
      type: 'tool-error'
    } & TypedToolError<ToolSet>
  ): void {
    const { toolCallId, error, input } = chunk
    const toolCallInfo = this.activeToolCalls.get(toolCallId)
    if (!toolCallInfo) {
      logger.warn(`🔧 [ToolCallChunkHandler] Tool call info not found for ID: ${toolCallId}`)
      return
    }
    const toolResponse: MCPToolResponse | NormalToolResponse = {
      id: toolCallId,
      tool: toolCallInfo.tool,
      arguments: input,
      status: 'error',
      response: error,
      toolCallId: toolCallId
    }
    this.activeToolCalls.delete(toolCallId)
    if (this.onChunk) {
      this.onChunk({
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [toolResponse]
      })
    }
  }
}

export const addActiveToolCall = ToolCallChunkHandler.addActiveToolCall.bind(ToolCallChunkHandler)

/**
 * 从工具输出中提取图片（使用 MCP SDK 类型安全验证）
 */
function extractImagesFromToolOutput(output: unknown): string[] {
  if (!output) {
    return []
  }

  const result = CallToolResultSchema.safeParse(output)
  if (result.success) {
    return result.data.content
      .filter((c) => c.type === 'image')
      .map((content) => `data:${content.mimeType ?? 'image/png'};base64,${content.data}`)
  }

  return []
}
