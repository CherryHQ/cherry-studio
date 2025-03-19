import { MCPTool, MCPToolResponse } from '@renderer/types'

import { processToolResponse } from '../utils/ToolUtils'

/**
 * Tool Handler
 * Handles tool invocation and processing
 */
export class ToolHandler {
  /**
   * Process tool use
   * @param toolUse Tool use object
   * @param mcpTools MCP tools
   * @param toolResponses Tool responses
   * @param bedrockMessages Bedrock messages
   * @param onChunk Chunk callback
   */
  public static async processToolUse(
    toolUse: any,
    mcpTools: MCPTool[] | undefined,
    toolResponses: MCPToolResponse[],
    bedrockMessages: any[],
    onChunk: (chunk: any) => void
  ): Promise<void> {
    if (!mcpTools || mcpTools.length === 0) return

    try {
      // Ensure toolUse has necessary fields
      if (!toolUse.name) {
        return
      }

      // Find matching MCP tool
      const toolName = toolUse.name
      const mcpTool = mcpTools.find((tool) => tool.name === toolName)

      if (!mcpTool) {
        return
      }

      // Parse tool input
      let toolInput = {}
      try {
        if (typeof toolUse.input === 'string') {
          toolInput = JSON.parse(toolUse.input)
        } else {
          toolInput = toolUse.input || {}
        }
      } catch (error) {
        toolInput = {}
      }

      // Generate unique tool call ID
      const toolUseId =
        toolUse.toolUseId || toolUse.id || `tooluse_${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

      // Notify UI that tool is being called
      processToolResponse(
        toolResponses,
        {
          tool: mcpTool,
          status: 'invoking',
          id: toolUseId
        },
        onChunk
      )

      // Call MCP tool
      // Create tool copy to avoid modifying original tool object
      const mcpToolCopy = { ...mcpTool }

      // Pass parameters directly to callMCPTool function
      // Note: We don't modify mcpToolCopy.inputSchema, but pass parameters directly
      const args: any = { ...toolInput }

      // Special handling for list_directory tool
      if (toolName === 'list_directory') {
        // Ensure path parameter exists
        if (!args.path && toolUse.input && typeof toolUse.input === 'object') {
          // Try to extract path parameter from input object
          const inputObj = toolUse.input as any
          args.path = inputObj.path
        }

        // If path parameter still doesn't exist, use default value
        if (!args.path) {
          args.path = '/Users/xrre/Downloads'
        }
      }

      // Call MCP tool with direct parameters
      const toolResponse = await window.api.mcp.callTool({
        client: mcpToolCopy.serverName,
        name: mcpToolCopy.name,
        args: args
      })

      // Notify UI that tool call is complete
      processToolResponse(
        toolResponses,
        { tool: mcpTool, status: 'done', response: toolResponse, id: toolUseId },
        onChunk
      )

      // Add assistant message to message list with tool use information
      bedrockMessages.push({
        role: 'assistant',
        content: [
          {
            toolUse: {
              toolUseId: toolUseId, // Use toolUseId instead of id
              name: toolName,
              input: toolInput
            }
          }
        ]
      })

      // Process tool response content
      let responseContent = ''
      if (toolResponse && toolResponse.content) {
        // If it's an array, try to extract text content
        if (Array.isArray(toolResponse.content)) {
          for (const item of toolResponse.content) {
            if (item.type === 'text' && item.text) {
              responseContent += item.text
            }
          }
        } else if (typeof toolResponse.content === 'string') {
          responseContent = toolResponse.content
        }
      }

      // If no content was extracted, try to use the entire response object
      if (!responseContent) {
        responseContent = typeof toolResponse === 'string' ? toolResponse : JSON.stringify(toolResponse)
      }

      // Add tool response to message list
      bedrockMessages.push({
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: toolUseId, // Make sure to use the same ID
              content: [
                {
                  text: responseContent
                }
              ],
              status: 'success'
            }
          }
        ]
      })
    } catch (error) {
      // 处理工具使用错误
    }
  }
}
