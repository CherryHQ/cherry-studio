import { ContentBlockParam, MessageParam, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { Content, FunctionCall, Part, Tool, Type as GeminiSchemaType } from '@google/genai'
import { loggerService } from '@logger'
import { isFunctionCallingModel, isVisionModel } from '@renderer/config/models'
import i18n from '@renderer/i18n'
import { currentSpan } from '@renderer/services/SpanManagerService'
import store from '@renderer/store'
import { addMCPServer } from '@renderer/store/mcp'
import {
  Assistant,
  MCPCallToolResponse,
  MCPServer,
  MCPTool,
  MCPToolResponse,
  Model,
  ToolUseResponse
} from '@renderer/types'
import type { MCPToolCompleteChunk, MCPToolInProgressChunk, MCPToolPendingChunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { nanoid } from 'nanoid'
import OpenAI from 'openai'
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources'

const logger = loggerService.withContext('Utils:MCPTools')

const MCP_AUTO_INSTALL_SERVER_NAME = '@cherry/mcp-auto-install'

/**
 * Recursively filters and validates properties for OpenAI o3 strict schema validation
 *
 * o3 strict mode requirements:
 * 1. ALL object schemas (including nested ones) must have complete required arrays with ALL property keys
 * 2. Object schemas with additionalProperties: false MUST have a properties field (even if empty)
 *
 * This function recursively processes the entire schema tree to ensure compliance.
 */
function filterProperties(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  // Handle arrays by recursively processing items
  if (Array.isArray(schema)) {
    return schema.map(filterProperties)
  }

  const filtered = { ...schema }

  // Process all properties recursively first
  if (filtered.properties && typeof filtered.properties === 'object') {
    const newProperties: any = {}
    for (const [key, value] of Object.entries(filtered.properties)) {
      newProperties[key] = filterProperties(value)
    }
    filtered.properties = newProperties
  }

  // Process other schema fields that might contain nested schemas
  if (filtered.items) {
    filtered.items = filterProperties(filtered.items)
  }
  if (filtered.additionalProperties && typeof filtered.additionalProperties === 'object') {
    filtered.additionalProperties = filterProperties(filtered.additionalProperties)
  }
  if (filtered.patternProperties) {
    const newPatternProperties: any = {}
    for (const [pattern, value] of Object.entries(filtered.patternProperties)) {
      newPatternProperties[pattern] = filterProperties(value)
    }
    filtered.patternProperties = newPatternProperties
  }

  // Handle schema composition keywords (array-based)
  const arrayCompositionKeywords = ['allOf', 'anyOf', 'oneOf']
  for (const keyword of arrayCompositionKeywords) {
    if (filtered[keyword]) {
      filtered[keyword] = filtered[keyword].map(filterProperties)
    }
  }

  // Handle single schema keywords
  const singleSchemaKeywords = ['not', 'if', 'then', 'else']
  for (const keyword of singleSchemaKeywords) {
    if (filtered[keyword]) {
      filtered[keyword] = filterProperties(filtered[keyword])
    }
  }

  // For ALL object schemas in strict mode, ensure proper o3 compliance
  if (filtered.type === 'object') {
    // o3 requirement: object schemas must have a properties field (even if empty)
    if (!filtered.properties) {
      filtered.properties = {}
    }

    // o3 strict requirement 1: ALL properties must be in required array
    const propertyKeys = Object.keys(filtered.properties)
    filtered.required = propertyKeys

    // o3 strict requirement 2: additionalProperties must ALWAYS be false for strict validation
    // This applies regardless of the original value (true, undefined, etc.)
    filtered.additionalProperties = false
  }

  return filtered
}

/**
 * Fixes object properties for o3 strict mode by ensuring objects have properties field (even if empty)
 */
function fixObjectPropertiesForO3(properties: Record<string, any>): Record<string, any> {
  const fixedProperties = { ...properties }
  for (const [propKey, propValue] of Object.entries(fixedProperties || {})) {
    if (propValue && typeof propValue === 'object') {
      const prop = propValue as any
      if (prop.type === 'object') {
        // For object types, ensure they have a properties field (even if empty) for o3 strict mode
        if (!prop.properties && prop.additionalProperties === false) {
          fixedProperties[propKey] = {
            ...prop,
            properties: {} // Add empty properties object for strict validation
          }
        }
      }
    }
  }
  return fixedProperties
}

/**
 * Processes MCP tool schema for OpenAI o3 strict validation requirements
 */
function processSchemaForO3(inputSchema: any): {
  properties: Record<string, any>
  required: string[]
  additionalProperties: boolean
} {
  const filteredSchema = filterProperties(inputSchema)

  // For strict mode (like o3), ensure ALL properties are in required array
  // This must be done AFTER filterProperties since it sets its own required array
  const allPropertyKeys = Object.keys(filteredSchema.properties || {})

  // Fix object properties for o3 strict mode - ensure objects have properties field
  const fixedProperties = fixObjectPropertiesForO3(filteredSchema.properties)

  // Create clean schema object to avoid mutations
  return {
    properties: fixedProperties || {},
    required: allPropertyKeys, // o3 requires ALL properties to be in required
    additionalProperties: false
  }
}

export function mcpToolsToOpenAIResponseTools(mcpTools: MCPTool[]): OpenAI.Responses.Tool[] {
  return mcpTools.map((tool) => {
    const parameters = processSchemaForO3(tool.inputSchema)

    return {
      type: 'function',
      name: tool.id,
      parameters: {
        type: 'object' as const,
        ...parameters
      },
      strict: true
    } satisfies OpenAI.Responses.Tool
  })
}

export function mcpToolsToOpenAIChatTools(mcpTools: MCPTool[]): Array<ChatCompletionTool> {
  return mcpTools.map((tool) => {
    const parameters = processSchemaForO3(tool.inputSchema)

    return {
      type: 'function',
      function: {
        name: tool.id,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          ...parameters
        },
        strict: true
      }
    } as ChatCompletionTool
  })
}

export function openAIToolsToMcpTool(
  mcpTools: MCPTool[],
  toolCall: OpenAI.Responses.ResponseFunctionToolCall | ChatCompletionMessageToolCall
): MCPTool | undefined {
  const tool = mcpTools.find((mcpTool) => {
    if ('name' in toolCall) {
      return mcpTool.id === toolCall.name || mcpTool.name === toolCall.name
    } else {
      return mcpTool.id === toolCall.function.name || mcpTool.name === toolCall.function.name
    }
  })

  if (!tool) {
    logger.warn('No MCP Tool found for tool call:', toolCall)
    return undefined
  }

  return tool
}

export async function callMCPTool(
  toolResponse: MCPToolResponse,
  topicId?: string,
  modelName?: string
): Promise<MCPCallToolResponse> {
  logger.info(`Calling Tool: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, toolResponse.tool)
  try {
    const server = getMcpServerByTool(toolResponse.tool)

    if (!server) {
      throw new Error(`Server not found: ${toolResponse.tool.serverName}`)
    }

    const resp = await window.api.mcp.callTool(
      {
        server,
        name: toolResponse.tool.name,
        args: toolResponse.arguments,
        callId: toolResponse.id
      },
      topicId ? currentSpan(topicId, modelName)?.spanContext() : undefined
    )
    if (toolResponse.tool.serverName === MCP_AUTO_INSTALL_SERVER_NAME) {
      if (resp.data) {
        const mcpServer: MCPServer = {
          id: `f${nanoid()}`,
          name: resp.data.name,
          description: resp.data.description,
          baseUrl: resp.data.baseUrl,
          command: resp.data.command,
          args: resp.data.args,
          env: resp.data.env,
          registryUrl: '',
          isActive: false,
          provider: 'CherryAI'
        }
        store.dispatch(addMCPServer(mcpServer))
      }
    }

    logger.info(`Tool called: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, resp)
    return resp
  } catch (e) {
    logger.error(`Error calling Tool: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, e)
    return Promise.resolve({
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error calling tool ${toolResponse.tool.name}: ${e instanceof Error ? e.stack || e.message || 'No error details available' : JSON.stringify(e)}`
        }
      ]
    })
  }
}

export function mcpToolsToAnthropicTools(mcpTools: MCPTool[]): Array<ToolUnion> {
  return mcpTools.map((tool) => {
    const t: ToolUnion = {
      name: tool.id,
      description: tool.description,
      // @ts-ignore ignore type as it it unknow
      input_schema: tool.inputSchema
    }
    return t
  })
}

export function anthropicToolUseToMcpTool(mcpTools: MCPTool[] | undefined, toolUse: ToolUseBlock): MCPTool | undefined {
  if (!mcpTools) return undefined
  const tool = mcpTools.find((tool) => tool.id === toolUse.name)
  if (!tool) {
    return undefined
  }
  return tool
}

/**
 * @param mcpTools
 * @returns
 */
export function mcpToolsToGeminiTools(mcpTools: MCPTool[]): Tool[] {
  return [
    {
      functionDeclarations: mcpTools?.map((tool) => {
        const filteredSchema = filterProperties(tool.inputSchema)
        return {
          name: tool.id,
          description: tool.description,
          parameters: {
            type: GeminiSchemaType.OBJECT,
            properties: filteredSchema.properties,
            required: tool.inputSchema.required
          }
        }
      })
    }
  ]
}

export function geminiFunctionCallToMcpTool(
  mcpTools: MCPTool[] | undefined,
  toolCall: FunctionCall | undefined
): MCPTool | undefined {
  if (!toolCall) return undefined
  if (!mcpTools) return undefined
  const tool = mcpTools.find((tool) => tool.id === toolCall.name || tool.name === toolCall.name)
  if (!tool) {
    return undefined
  }
  return tool
}

export function upsertMCPToolResponse(
  results: MCPToolResponse[],
  resp: MCPToolResponse,
  onChunk: (chunk: MCPToolPendingChunk | MCPToolInProgressChunk | MCPToolCompleteChunk) => void
) {
  const index = results.findIndex((ret) => ret.id === resp.id)
  let result = resp
  if (index !== -1) {
    const cur = {
      ...results[index],
      response: resp.response,
      arguments: resp.arguments,
      status: resp.status
    }
    results[index] = cur
    result = cur
  } else {
    results.push(resp)
  }
  switch (resp.status) {
    case 'pending':
      onChunk({
        type: ChunkType.MCP_TOOL_PENDING,
        responses: [result]
      })
      break
    case 'invoking':
      onChunk({
        type: ChunkType.MCP_TOOL_IN_PROGRESS,
        responses: [result]
      })
      break
    case 'cancelled':
    case 'done':
      onChunk({
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [result]
      })
      break
    default:
      break
  }
}

export function filterMCPTools(
  mcpTools: MCPTool[] | undefined,
  enabledServers: MCPServer[] | undefined
): MCPTool[] | undefined {
  if (mcpTools) {
    if (enabledServers) {
      mcpTools = mcpTools.filter((t) => enabledServers.some((m) => m.name === t.serverName))
    } else {
      mcpTools = []
    }
  }
  return mcpTools
}

export function getMcpServerByTool(tool: MCPTool) {
  const servers = store.getState().mcp.servers
  return servers.find((s) => s.id === tool.serverId)
}

export function isToolAutoApproved(tool: MCPTool, server?: MCPServer): boolean {
  const effectiveServer = server ?? getMcpServerByTool(tool)
  return effectiveServer ? !effectiveServer.disabledAutoApproveTools?.includes(tool.name) : false
}

export function parseToolUse(content: string, mcpTools: MCPTool[], startIdx: number = 0): ToolUseResponse[] {
  if (!content || !mcpTools || mcpTools.length === 0) {
    return []
  }

  // 支持两种格式：
  // 1. 完整的 <tool_use></tool_use> 标签包围的内容
  // 2. 只有内部内容（从 TagExtractor 提取出来的）

  let contentToProcess = content

  // 如果内容不包含 <tool_use> 标签，说明是从 TagExtractor 提取的内部内容，需要包装
  if (!content.includes('<tool_use>')) {
    contentToProcess = `<tool_use>\n${content}\n</tool_use>`
  }

  const toolUsePattern =
    /<tool_use>([\s\S]*?)<name>([\s\S]*?)<\/name>([\s\S]*?)<arguments>([\s\S]*?)<\/arguments>([\s\S]*?)<\/tool_use>/g
  const tools: ToolUseResponse[] = []
  let match
  let idx = startIdx
  // Find all tool use blocks
  while ((match = toolUsePattern.exec(contentToProcess)) !== null) {
    // const fullMatch = match[0]
    const toolName = match[2].trim()
    const toolArgs = match[4].trim()

    // Try to parse the arguments as JSON
    let parsedArgs
    try {
      parsedArgs = JSON.parse(toolArgs)
    } catch (error) {
      // If parsing fails, use the string as is
      parsedArgs = toolArgs
    }
    // Logger.log(`Parsed arguments for tool "${toolName}":`, parsedArgs)
    const mcpTool = mcpTools.find((tool) => tool.id === toolName)
    if (!mcpTool) {
      logger.error(`Tool "${toolName}" not found in MCP tools`)
      window.message.error(i18n.t('settings.mcp.errors.toolNotFound', { name: toolName }))
      continue
    }

    // Add to tools array
    tools.push({
      id: `${toolName}-${idx++}`, // Unique ID for each tool use
      toolUseId: mcpTool.id,
      tool: mcpTool,
      arguments: parsedArgs,
      status: 'pending'
    })

    // Remove the tool use block from the content
    // content = content.replace(fullMatch, '')
  }
  return tools
}

export function mcpToolCallResponseToOpenAICompatibleMessage(
  mcpToolResponse: MCPToolResponse,
  resp: MCPCallToolResponse,
  isVisionModel: boolean = false,
  isCompatibleMode: boolean = false
): ChatCompletionMessageParam {
  const message = {
    role: 'user'
  } as ChatCompletionMessageParam
  if (resp.isError) {
    message.content = JSON.stringify(resp.content)
  } else if (isCompatibleMode) {
    let content: string = `Here is the result of mcp tool use \`${mcpToolResponse.tool.name}\`:\n`

    if (isVisionModel) {
      for (const item of resp.content) {
        switch (item.type) {
          case 'text':
            content += (item.text || 'no content') + '\n'
            break
          case 'image':
            // NOTE: 假设兼容模式下支持解析base64图片，虽然我觉得应该不支持
            content += `Here is a image result: data:${item.mimeType};base64,${item.data}\n`
            break
          case 'audio':
            // NOTE: 假设兼容模式下支持解析base64音频，虽然我觉得应该不支持
            content += `Here is a audio result: data:${item.mimeType};base64,${item.data}\n`
            break
          default:
            content += `Here is a unsupported result type: ${item.type}\n`
            break
        }
      }
    } else {
      content += JSON.stringify(resp.content)
      content += '\n'
    }

    message.content = content
  } else {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `Here is the result of mcp tool use \`${mcpToolResponse.tool.name}\`:`
      }
    ]

    if (isVisionModel) {
      for (const item of resp.content) {
        switch (item.type) {
          case 'text':
            content.push({
              type: 'text',
              text: item.text || 'no content'
            })
            break
          case 'image':
            content.push({
              type: 'image_url',
              image_url: {
                url: `data:${item.mimeType};base64,${item.data}`,
                detail: 'auto'
              }
            })
            break
          case 'audio':
            content.push({
              type: 'input_audio',
              input_audio: {
                data: `data:${item.mimeType};base64,${item.data}`,
                format: 'mp3'
              }
            })
            break
          default:
            content.push({
              type: 'text',
              text: `Unsupported type: ${item.type}`
            })
            break
        }
      }
    } else {
      content.push({
        type: 'text',
        text: JSON.stringify(resp.content)
      })
    }

    message.content = content
  }

  return message
}

export function mcpToolCallResponseToOpenAIMessage(
  mcpToolResponse: MCPToolResponse,
  resp: MCPCallToolResponse,
  isVisionModel: boolean = false
): OpenAI.Responses.EasyInputMessage {
  const message = {
    role: 'user'
  } as OpenAI.Responses.EasyInputMessage

  if (resp.isError) {
    message.content = JSON.stringify(resp.content)
  } else {
    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: 'input_text',
        text: `Here is the result of mcp tool use \`${mcpToolResponse.tool.name}\`:`
      }
    ]

    if (isVisionModel) {
      for (const item of resp.content) {
        switch (item.type) {
          case 'text':
            content.push({
              type: 'input_text',
              text: item.text || 'no content'
            })
            break
          case 'image':
            content.push({
              type: 'input_image',
              image_url: `data:${item.mimeType};base64,${item.data}`,
              detail: 'auto'
            })
            break
          default:
            content.push({
              type: 'input_text',
              text: `Unsupported type: ${item.type}`
            })
            break
        }
      }
    } else {
      content.push({
        type: 'input_text',
        text: JSON.stringify(resp.content)
      })
    }

    message.content = content
  }

  return message
}

export function mcpToolCallResponseToAnthropicMessage(
  mcpToolResponse: MCPToolResponse,
  resp: MCPCallToolResponse,
  model: Model
): MessageParam {
  const message = {
    role: 'user'
  } as MessageParam
  if (resp.isError) {
    message.content = JSON.stringify(resp.content)
  } else {
    const content: ContentBlockParam[] = [
      {
        type: 'text',
        text: `Here is the result of mcp tool use \`${mcpToolResponse.tool.name}\`:`
      }
    ]
    if (isVisionModel(model)) {
      for (const item of resp.content) {
        switch (item.type) {
          case 'text':
            content.push({
              type: 'text',
              text: item.text || 'no content'
            })
            break
          case 'image':
            if (
              item.mimeType === 'image/png' ||
              item.mimeType === 'image/jpeg' ||
              item.mimeType === 'image/webp' ||
              item.mimeType === 'image/gif'
            ) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  data: `data:${item.mimeType};base64,${item.data}`,
                  media_type: item.mimeType
                }
              })
            } else {
              content.push({
                type: 'text',
                text: `Unsupported image type: ${item.mimeType}`
              })
            }
            break
          default:
            content.push({
              type: 'text',
              text: `Unsupported type: ${item.type}`
            })
            break
        }
      }
    } else {
      content.push({
        type: 'text',
        text: JSON.stringify(resp.content)
      })
    }
    message.content = content
  }

  return message
}

export function mcpToolCallResponseToGeminiMessage(
  mcpToolResponse: MCPToolResponse,
  resp: MCPCallToolResponse,
  isVisionModel: boolean = false
): Content {
  const message = {
    role: 'user'
  } as Content

  if (resp.isError) {
    message.parts = [
      {
        text: JSON.stringify(resp.content)
      }
    ]
  } else {
    const parts: Part[] = [
      {
        text: `Here is the result of mcp tool use \`${mcpToolResponse.tool.name}\`:`
      }
    ]
    if (isVisionModel) {
      for (const item of resp.content) {
        switch (item.type) {
          case 'text':
            parts.push({
              text: item.text || 'no content'
            })
            break
          case 'image':
            if (!item.data) {
              parts.push({
                text: 'No image data provided'
              })
            } else {
              parts.push({
                inlineData: {
                  data: item.data,
                  mimeType: item.mimeType || 'image/png'
                }
              })
            }
            break
          default:
            parts.push({
              text: `Unsupported type: ${item.type}`
            })
            break
        }
      }
    } else {
      parts.push({
        text: JSON.stringify(resp.content)
      })
    }
    message.parts = parts
  }

  return message
}

export function isEnabledToolUse(assistant: Assistant) {
  if (assistant.model) {
    if (isFunctionCallingModel(assistant.model)) {
      return assistant.settings?.toolUseMode === 'function'
    }
  }

  return false
}
