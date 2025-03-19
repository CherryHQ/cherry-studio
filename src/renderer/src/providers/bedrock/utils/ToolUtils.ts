import { MCPTool, MCPToolResponse } from '@renderer/types'
import { filterMCPTools, upsertMCPToolResponse } from '@renderer/utils/mcp-tools'

/**
 * Filter MCP tools based on enabled MCPs
 * @param mcpTools MCP tools
 * @param enabledMCPs Enabled MCPs
 * @returns Filtered MCP tools
 */
export function filterTools(mcpTools: MCPTool[] | undefined, enabledMCPs?: string[]): MCPTool[] {
  return filterMCPTools(mcpTools, enabledMCPs as any) || []
}

/**
 * Process tool response
 * @param toolResponses Tool response array
 * @param toolResponse Tool response
 * @param onChunk Chunk callback
 */
export function processToolResponse(
  toolResponses: MCPToolResponse[],
  toolResponse: MCPToolResponse,
  onChunk: (chunk: any) => void
): void {
  upsertMCPToolResponse(toolResponses, toolResponse, onChunk)
}

/**
 * Create tool configuration for inference
 * @param mcpTools MCP tools
 * @returns Tool configuration
 */
export function createToolConfig(mcpTools: MCPTool[] | undefined) {
  if (!mcpTools || mcpTools.length === 0) return undefined

  return {
    tools: mcpTools.map((tool) => {
      // Create a new schema object
      const schema: any = {
        type: 'object',
        properties: {}
      }

      // If tool.inputSchema exists, process its properties
      if (tool.inputSchema) {
        // Copy basic properties
        if (tool.inputSchema.type) schema.type = tool.inputSchema.type
        if (tool.inputSchema.description) schema.description = tool.inputSchema.description
        if (tool.inputSchema.required) schema.required = tool.inputSchema.required

        // Inline expand $ref references
        if (tool.inputSchema.properties) {
          // Copy properties object
          const properties: any = {}

          // Process each property
          for (const [key, value] of Object.entries(tool.inputSchema.properties)) {
            const prop = value as any

            // If property contains $ref reference, expand it
            if (prop.$ref) {
              // Create inline definition based on $ref content
              if (prop.$ref.includes('BedrockLogsParams')) {
                properties[key] = {
                  type: 'object',
                  properties: {
                    days: { type: 'integer', description: 'Number of days to look back' },
                    region: { type: 'string', description: 'AWS region' }
                  },
                  required: ['days', 'region']
                }
              } else if (prop.$ref.includes('DaysParam')) {
                properties[key] = {
                  type: 'object',
                  properties: {
                    days: { type: 'integer', description: 'Number of days to look back' }
                  },
                  required: ['days']
                }
              } else {
                // For other unknown $refs, use empty object as substitute
                properties[key] = { type: 'object', properties: {} }
              }
            } else {
              // If no $ref, copy property directly
              properties[key] = prop
            }
          }

          schema.properties = properties
        }
      }

      return {
        toolSpec: {
          name: tool.name,
          description: tool.description || '',
          inputSchema: {
            json: schema
          }
        }
      }
    }),
    toolChoice: { auto: {} }
  }
}

/**
 * Filter messages for tool use
 * Ensures each toolResult has a corresponding toolUse
 * @param messages Original message array
 * @returns Filtered message array
 */
export function filterMessagesForToolUse(messages: any[]): any[] {
  // Track used toolUse IDs
  const toolUseIds = new Set<string>()

  // First pass: collect all toolUse IDs
  for (const message of messages) {
    if (message.role === 'assistant' && message.content) {
      for (const block of message.content) {
        if (block.toolUse && block.toolUse.toolUseId) {
          toolUseIds.add(block.toolUse.toolUseId)
        } else if (block.toolUse && block.toolUse.id) {
          // Backward compatibility: if old format id is found, add it to the set
          toolUseIds.add(block.toolUse.id)
        }
      }
    }
  }

  // If no toolUse found, return only the last user message without toolResult
  if (toolUseIds.size === 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && !hasToolResult(messages[i])) {
        return [messages[i]]
      }
    }
    // If no suitable user message found, return empty array
    return []
  }

  // Second pass: filter messages, only keep valid ones
  const filteredMessages: any[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    let shouldIncludeMessage = true

    // Check if message content is valid
    if (message.content) {
      // Check if it's a user message containing toolResult
      if (message.role === 'user') {
        for (const block of message.content) {
          if (block.toolResult) {
            // Check if toolUseId exists and is valid
            const toolUseId = block.toolResult.toolUseId

            if (!toolUseId) {
              shouldIncludeMessage = false
              break
            }

            if (!toolUseIds.has(toolUseId)) {
              shouldIncludeMessage = false
              break
            }
          }
        }
      }

      // Check if it's an assistant message containing toolUse
      if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.toolUse) {
            // Ensure toolUse.toolUseId exists
            if (!block.toolUse.toolUseId && !block.toolUse.id) {
              shouldIncludeMessage = false
              break
            }
          }
        }
      }
    }

    if (shouldIncludeMessage) {
      filteredMessages.push(message)
    }
  }

  // Final check: ensure all messages have valid content
  const finalMessages = filteredMessages.filter((message) => {
    if (!message.content || message.content.length === 0) {
      return false
    }
    return true
  })

  return finalMessages
}

/**
 * Check if message contains toolResult
 * @param message Message object
 * @returns Whether message contains toolResult
 */
export function hasToolResult(message: any): boolean {
  if (!message.content) {
    return false
  }

  for (const block of message.content) {
    if (block.toolResult) {
      return true
    }
  }

  return false
}
