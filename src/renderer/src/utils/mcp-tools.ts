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
import { isArray, isObject, pull, transform } from 'lodash'
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
const EXTRA_SCHEMA_KEYS = ['schema', 'headers']

// const ensureValidSchema = (obj: Record<string, any>) => {
//   // Filter out unsupported keys for Gemini
//   const filteredObj = filterUnsupportedKeys(obj)

//   // Handle base schema properties
//   const baseSchema = {
//     description: filteredObj.description,
//     nullable: filteredObj.nullable
//   } as BaseSchema

//   // Handle string type
//   if (filteredObj.type?.toLowerCase() === SchemaType.STRING) {
//     if (filteredObj.enum && Array.isArray(filteredObj.enum)) {
//       return {
//         ...baseSchema,
//         type: SchemaType.STRING,
//         format: 'enum',
//         enum: filteredObj.enum as string[]
//       } as EnumStringSchema
//     }
//     return {
//       ...baseSchema,
//       type: SchemaType.STRING,
//       format: filteredObj.format === 'date-time' ? 'date-time' : undefined
//     } as SimpleStringSchema
//   }

//   // Handle number type
//   if (filteredObj.type?.toLowerCase() === SchemaType.NUMBER) {
//     return {
//       ...baseSchema,
//       type: SchemaType.NUMBER,
//       format: ['float', 'double'].includes(filteredObj.format) ? (filteredObj.format as 'float' | 'double') : undefined
//     } as NumberSchema
//   }

//   // Handle integer type
//   if (filteredObj.type?.toLowerCase() === SchemaType.INTEGER) {
//     return {
//       ...baseSchema,
//       type: SchemaType.INTEGER,
//       format: ['int32', 'int64'].includes(filteredObj.format) ? (filteredObj.format as 'int32' | 'int64') : undefined
//     } as IntegerSchema
//   }

//   // Handle boolean type
//   if (filteredObj.type?.toLowerCase() === SchemaType.BOOLEAN) {
//     return {
//       ...baseSchema,
//       type: SchemaType.BOOLEAN
//     } as BooleanSchema
//   }

//   // Handle array type
//   if (filteredObj.type?.toLowerCase() === SchemaType.ARRAY) {
//     return {
//       ...baseSchema,
//       type: SchemaType.ARRAY,
//       items: filteredObj.items
//         ? ensureValidSchema(filteredObj.items as Record<string, any>)
//         : ({ type: SchemaType.STRING } as SimpleStringSchema),
//       minItems: filteredObj.minItems,
//       maxItems: filteredObj.maxItems
//     } as ArraySchema
//   }

//   // Handle object type (default)
//   const properties = filteredObj.properties
//     ? Object.fromEntries(
//         Object.entries(filteredObj.properties).map(([key, value]) => [
//           key,
//           ensureValidSchema(value as Record<string, any>)
//         ])
//       )
//     : { _empty: { type: SchemaType.STRING } as SimpleStringSchema } // Ensure properties is never empty

//   return {
//     ...baseSchema,
//     type: SchemaType.OBJECT,
//     properties,
//     required: Array.isArray(filteredObj.required) ? filteredObj.required : undefined
//   } as ObjectSchema
// }

// function filterUnsupportedKeys(obj: Record<string, any>): Record<string, any> {
//   const supportedBaseKeys = ['description', 'nullable']
//   const supportedStringKeys = [...supportedBaseKeys, 'type', 'format', 'enum']
//   const supportedNumberKeys = [...supportedBaseKeys, 'type', 'format']
//   const supportedBooleanKeys = [...supportedBaseKeys, 'type']
//   const supportedArrayKeys = [...supportedBaseKeys, 'type', 'items', 'minItems', 'maxItems']
//   const supportedObjectKeys = [...supportedBaseKeys, 'type', 'properties', 'required']

//   const filtered: Record<string, any> = {}

//   let keysToKeep: string[]

//   if (obj.type?.toLowerCase() === SchemaType.STRING) {
//     keysToKeep = supportedStringKeys
//   } else if (obj.type?.toLowerCase() === SchemaType.NUMBER) {
//     keysToKeep = supportedNumberKeys
//   } else if (obj.type?.toLowerCase() === SchemaType.INTEGER) {
//     keysToKeep = supportedNumberKeys
//   } else if (obj.type?.toLowerCase() === SchemaType.BOOLEAN) {
//     keysToKeep = supportedBooleanKeys
//   } else if (obj.type?.toLowerCase() === SchemaType.ARRAY) {
//     keysToKeep = supportedArrayKeys
//   } else {
//     // Default to object type
//     keysToKeep = supportedObjectKeys
//   }

//   // copy supported keys
//   for (const key of keysToKeep) {
//     if (obj[key] !== undefined) {
//       filtered[key] = obj[key]
//     }
//   }

//   return filtered
// }

// function filterPropertieAttributes(tool: MCPTool, filterNestedObj: boolean = false): Record<string, object> {
//   const properties = tool.inputSchema.properties
//   if (!properties) {
//     return {}
//   }

//   // For OpenAI, we don't need to validate as strictly
//   if (!filterNestedObj) {
//     return properties
//   }

//   const processedProperties = Object.fromEntries(
//     Object.entries(properties).map(([key, value]) => [key, ensureValidSchema(value as Record<string, any>)])
//   )

//   return processedProperties
// }

export function filterProperties(
  properties: Record<string, any> | string | number | boolean | Array<Record<string, any> | string | number | boolean>,
  supportedKeys: string[]
) {
  // If it is an array, recursively process each element
  if (isArray(properties)) {
    return properties.map((item) => filterProperties(item, supportedKeys))
  }

  // If it is an object, recursively process each property
  if (isObject(properties)) {
    return transform(
      properties,
      (result, value, key) => {
        if (key === 'properties') {
          result[key] = transform(value, (acc, v, k) => {
            acc[k] = filterProperties(v, supportedKeys)
          })

          result['additionalProperties'] = false
          result['required'] = pull(Object.keys(value), ...EXTRA_SCHEMA_KEYS)
        } else if (key === 'oneOf') {
          // openai only supports anyOf
          result['anyOf'] = filterProperties(value, supportedKeys)
        } else if (supportedKeys.includes(key)) {
          result[key] = filterProperties(value, supportedKeys)
          if (key === 'type' && value === 'object') {
            result['additionalProperties'] = false
          }
        }
      },
      {}
    )
  }

  // Return other types directly (e.g., string, number, etc.)
  return properties
}

export function mcpToolsToOpenAIResponseTools(mcpTools: MCPTool[]): OpenAI.Responses.Tool[] {
  const schemaKeys = ['type', 'description', 'items', 'enum', 'additionalProperties', 'anyof']
  return mcpTools.map(
    (tool) =>
      ({
        type: 'function',
        name: tool.id,
        parameters: {
          type: 'object',
          properties: filterProperties(tool.inputSchema, schemaKeys).properties,
          required: pull(Object.keys(tool.inputSchema.properties), ...EXTRA_SCHEMA_KEYS),
          additionalProperties: false
        },
        strict: true
      }) satisfies OpenAI.Responses.Tool
  )
}

export function mcpToolsToOpenAIChatTools(mcpTools: MCPTool[]): Array<ChatCompletionTool> {
  return mcpTools.map(
    (tool) =>
      ({
        type: 'function',
        function: {
          name: tool.id,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: tool.inputSchema.properties,
            required: tool.inputSchema.required
          }
        }
      }) as ChatCompletionTool
  )
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

export async function callBuiltInTool(toolResponse: MCPToolResponse): Promise<MCPCallToolResponse | undefined> {
  logger.info(`[BuiltIn] Calling Built-in Tool: ${toolResponse.tool.name}`, toolResponse.tool)

  if (toolResponse.tool.name === 'think') {
    const thought = toolResponse.arguments?.thought
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: (thought as string) || ''
        }
      ]
    }
  }

  return undefined
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
    logger.error(`Error calling Tool: ${toolResponse.tool.serverName} ${toolResponse.tool.name}`, e as Error)
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
  /**
   * @typedef {import('@google/genai').Schema} Schema
   */
  const schemaKeys = [
    'example',
    'pattern',
    'default',
    'maxLength',
    'minLength',
    'minProperties',
    'maxProperties',
    'anyOf',
    'description',
    'enum',
    'format',
    'items',
    'maxItems',
    'maximum',
    'minItems',
    'minimum',
    'nullable',
    'properties',
    'propertyOrdering',
    'required',
    'title',
    'type'
  ]
  return [
    {
      functionDeclarations: mcpTools?.map((tool) => {
        return {
          name: tool.id,
          description: tool.description,
          parameters: {
            type: GeminiSchemaType.OBJECT,
            properties: filterProperties(tool.inputSchema, schemaKeys).properties,
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
