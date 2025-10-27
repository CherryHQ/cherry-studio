/**
 * 工具调用 Chunk 处理模块
 * TODO: Tool包含了providerTool和普通的Tool还有MCPTool,后面需要重构
 * 提供工具调用相关的处理API，每个交互使用一个新的实例
 */

import { loggerService } from '@logger'
import { processKnowledgeReferences } from '@renderer/services/KnowledgeService'
import { BaseTool, MCPTool, MCPToolResponse, NormalToolResponse } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import type { ToolSet, TypedToolCall, TypedToolError, TypedToolResult } from 'ai'

const logger = loggerService.withContext('ToolCallChunkHandler')

export type ToolcallsMap = {
  toolCallId: string
  toolName: string
  args: any
  // mcpTool 现在可以是 MCPTool 或我们为 Provider 工具创建的通用类型
  tool: BaseTool
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

  //   /**
  //    * 设置 onChunk 回调
  //    */
  //   public setOnChunk(callback: (chunk: Chunk) => void): void {
  //     this.onChunk = callback
  //   }

  // handleToolCallCreated(
  //   chunk:
  //     | {
  //         type: 'tool-input-start'
  //         id: string
  //         toolName: string
  //         providerMetadata?: ProviderMetadata
  //         providerExecuted?: boolean
  //       }
  //     | {
  //         type: 'tool-input-end'
  //         id: string
  //         providerMetadata?: ProviderMetadata
  //       }
  //     | {
  //         type: 'tool-input-delta'
  //         id: string
  //         delta: string
  //         providerMetadata?: ProviderMetadata
  //       }
  // ): void {
  //   switch (chunk.type) {
  //     case 'tool-input-start': {
  //       // 能拿到说明是mcpTool
  //       // if (this.activeToolCalls.get(chunk.id)) return

  //       const tool: BaseTool | MCPTool = {
  //         id: chunk.id,
  //         name: chunk.toolName,
  //         description: chunk.toolName,
  //         type: chunk.toolName.startsWith('builtin_') ? 'builtin' : 'provider'
  //       }
  //       this.activeToolCalls.set(chunk.id, {
  //         toolCallId: chunk.id,
  //         toolName: chunk.toolName,
  //         args: '',
  //         tool
  //       })
  //       const toolResponse: MCPToolResponse | NormalToolResponse = {
  //         id: chunk.id,
  //         tool: tool,
  //         arguments: {},
  //         status: 'pending',
  //         toolCallId: chunk.id
  //       }
  //       this.onChunk({
  //         type: ChunkType.MCP_TOOL_PENDING,
  //         responses: [toolResponse]
  //       })
  //       break
  //     }
  //     case 'tool-input-delta': {
  //       const toolCall = this.activeToolCalls.get(chunk.id)
  //       if (!toolCall) {
  //         logger.warn(`🔧 [ToolCallChunkHandler] Tool call not found: ${chunk.id}`)
  //         return
  //       }
  //       toolCall.args += chunk.delta
  //       break
  //     }
  //     case 'tool-input-end': {
  //       const toolCall = this.activeToolCalls.get(chunk.id)
  //       this.activeToolCalls.delete(chunk.id)
  //       if (!toolCall) {
  //         logger.warn(`🔧 [ToolCallChunkHandler] Tool call not found: ${chunk.id}`)
  //         return
  //       }
  //       // const toolResponse: ToolCallResponse = {
  //       //   id: toolCall.toolCallId,
  //       //   tool: toolCall.tool,
  //       //   arguments: toolCall.args,
  //       //   status: 'pending',
  //       //   toolCallId: toolCall.toolCallId
  //       // }
  //       // logger.debug('toolResponse', toolResponse)
  //       // this.onChunk({
  //       //   type: ChunkType.MCP_TOOL_PENDING,
  //       //   responses: [toolResponse]
  //       // })
  //       break
  //     }
  //   }
  //   // if (!toolCall) {
  //   //   Logger.warn(`🔧 [ToolCallChunkHandler] Tool call not found: ${chunk.id}`)
  //   //   return
  //   // }
  //   // this.onChunk({
  //   //   type: ChunkType.MCP_TOOL_CREATED,
  //   //   tool_calls: [
  //   //     {
  //   //       id: chunk.id,
  //   //       name: chunk.toolName,
  //   //       status: 'pending'
  //   //     }
  //   //   ]
  //   // })
  // }

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
    } else if ((mcpTool = this.mcpTools.find((t) => t.name === toolName) as MCPTool)) {
      // 如果是客户端执行的 MCP 工具，沿用现有逻辑
      logger.info(`[ToolCallChunkHandler] Handling client-side MCP tool: ${toolName}`)
      // mcpTool = this.mcpTools.find((t) => t.name === toolName) as MCPTool
      // if (!mcpTool) {
      //   logger.warn(`[ToolCallChunkHandler] MCP tool not found: ${toolName}`)
      //   return
      // }
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

    // 工具特定的后处理
    switch (toolResponse.tool.name) {
      case 'builtin_knowledge_search': {
        processKnowledgeReferences(toolResponse.response, this.onChunk)
        break
      }
      // 未来可以在这里添加其他工具的后处理逻辑
      default:
        break
    }

    // 从活跃调用中移除（交互结束后整个实例会被丢弃）
    this.activeToolCalls.delete(toolCallId)

    // 调用 onChunk
    if (this.onChunk) {
      this.onChunk({
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [toolResponse]
      })

      const images: string[] = []
      for (const content of toolResponse.response?.content || []) {
        if (content.type === 'image' && content.data) {
          images.push(`data:${content.mimeType};base64,${content.data}`)
        }
      }

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
