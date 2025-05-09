import { ContentBlockParam, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { MessageParam } from '@anthropic-ai/sdk/resources'
import { Content, FunctionCall, Part } from '@google/genai'
import store from '@renderer/store'
import { addMCPServer } from '@renderer/store/mcp'
import { MCPCallToolResponse, MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import type { MCPToolCompleteChunk, MCPToolInProgressChunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { nanoid } from 'nanoid'
import OpenAI from 'openai'
import { ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionMessageToolCall } from 'openai/resources'

import { CompletionsParams } from '../providers/AiProvider'

const MCP_AUTO_INSTALL_SERVER_NAME = '@cherry/mcp-auto-install'

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

// export function mcpToolsToOpenAITools(mcpTools: MCPTool[]): Array<ChatCompletionTool> {
//   return mcpTools.map((tool) => ({
//     type: 'function',
//     name: tool.name,
//     function: {
//       name: tool.id,
//       description: tool.description,
//       parameters: {
//         type: 'object',
//         properties: filterPropertieAttributes(tool)
//       }
//     }
//   }))
// }

export function openAIToolsToMcpTool(
  mcpTools: MCPTool[] | undefined,
  llmTool: ChatCompletionMessageToolCall
): MCPTool | undefined {
  if (!mcpTools) {
    return undefined
  }

  const tool = mcpTools.find(
    (mcptool) => mcptool.id === llmTool.function.name || mcptool.name === llmTool.function.name
  )

  if (!tool) {
    console.warn('No MCP Tool found for tool call:', llmTool)
    return undefined
  }

  console.log(
    `[MCP] OpenAI Tool to MCP Tool: ${tool.serverName} ${tool.name}`,
    tool,
    'args',
    llmTool.function.arguments
  )
  // use this to parse the arguments and avoid parsing errors
  let args: any = {}
  try {
    args = JSON.parse(llmTool.function.arguments)
  } catch (e) {
    console.error('Error parsing arguments', e)
  }

  return {
    id: tool.id,
    serverId: tool.serverId,
    serverName: tool.serverName,
    name: tool.name,
    description: tool.description,
    inputSchema: args
  }
}

export async function callMCPTool(tool: MCPTool): Promise<MCPCallToolResponse> {
  console.log(`[MCP] Calling Tool: ${tool.serverName} ${tool.name}`, tool)
  try {
    const server = getMcpServerByTool(tool)

    if (!server) {
      throw new Error(`Server not found: ${tool.serverName}`)
    }

    const resp = await window.api.mcp.callTool({
      server,
      name: tool.name,
      args: tool.inputSchema
    })
    if (tool.serverName === MCP_AUTO_INSTALL_SERVER_NAME) {
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

    console.log(`[MCP] Tool called: ${tool.serverName} ${tool.name}`, resp)
    return resp
  } catch (e) {
    console.error(`[MCP] Error calling Tool: ${tool.serverName} ${tool.name}`, e)
    return Promise.resolve({
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error calling tool ${tool.name}: ${e instanceof Error ? e.stack || e.message || 'No error details available' : JSON.stringify(e)}`
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
      // @ts-ignore no check
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
  // @ts-ignore ignore type as it it unknow
  tool.inputSchema = toolUse.input
  return tool
}

// export function mcpToolsToGeminiTools(mcpTools: MCPTool[] | undefined): geminiTool[] {
//   if (!mcpTools || mcpTools.length === 0) {
//     // No tools available
//     return []
//   }
//   const functions: FunctionDeclaration[] = []

//   for (const tool of mcpTools) {
//     const properties = filterPropertieAttributes(tool, true)
//     const functionDeclaration: FunctionDeclaration = {
//       name: tool.id,
//       description: tool.description,
//       parameters: {
//         type: SchemaType.OBJECT,
//         properties:
//           Object.keys(properties).length > 0
//             ? Object.fromEntries(
//                 Object.entries(properties).map(([key, value]) => [key, ensureValidSchema(value as Record<string, any>)])
//               )
//             : { _empty: { type: SchemaType.STRING } as SimpleStringSchema }
//       } as FunctionDeclarationSchema
//     }
//     functions.push(functionDeclaration)
//   }
//   const tool: geminiTool = {
//     functionDeclarations: functions
//   }
//   return [tool]
// }

export function geminiFunctionCallToMcpTool(
  mcpTools: MCPTool[] | undefined,
  fcall: FunctionCall | undefined
): MCPTool | undefined {
  if (!fcall) return undefined
  if (!mcpTools) return undefined
  const tool = mcpTools.find((tool) => tool.id === fcall.name)
  if (!tool) {
    return undefined
  }
  // @ts-ignore schema is not a valid property
  tool.inputSchema = fcall.args
  return tool
}

export function upsertMCPToolResponse(
  results: MCPToolResponse[],
  resp: MCPToolResponse,
  onChunk: (chunk: MCPToolInProgressChunk | MCPToolCompleteChunk) => void
) {
  const index = results.findIndex((ret) => ret.id === resp.id)
  let result = resp
  if (index !== -1) {
    const cur = {
      ...results[index],
      response: resp.response,
      status: resp.status
    }
    results[index] = cur
    result = cur
  } else {
    results.push(resp)
  }
  onChunk({
    type: resp.status === 'invoking' ? ChunkType.MCP_TOOL_IN_PROGRESS : ChunkType.MCP_TOOL_COMPLETE,
    responses: [result]
  })
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

export function parseToolUse(content: string, mcpTools: MCPTool[]): MCPToolResponse[] {
  if (!content || !mcpTools || mcpTools.length === 0) {
    return []
  }
  const toolUsePattern =
    /<tool_use>([\s\S]*?)<name>([\s\S]*?)<\/name>([\s\S]*?)<arguments>([\s\S]*?)<\/arguments>([\s\S]*?)<\/tool_use>/g
  const tools: MCPToolResponse[] = []
  let match
  let idx = 0
  // Find all tool use blocks
  while ((match = toolUsePattern.exec(content)) !== null) {
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
    // console.log(`Parsed arguments for tool "${toolName}":`, parsedArgs)
    const mcpTool = mcpTools.find((tool) => tool.id === toolName)
    if (!mcpTool) {
      console.error(`Tool "${toolName}" not found in MCP tools`)
      continue
    }

    // Add to tools array
    tools.push({
      id: `${toolName}-${idx++}`, // Unique ID for each tool use
      tool: {
        ...mcpTool,
        inputSchema: parsedArgs
      },
      status: 'pending'
    })

    // Remove the tool use block from the content
    // content = content.replace(fullMatch, '')
  }
  return tools
}

export async function parseAndCallTools(
  content: string,
  toolResponses: MCPToolResponse[],
  onChunk: CompletionsParams['onChunk'],
  idx: number,
  convertToMessage: (
    toolCallId: string,
    resp: MCPCallToolResponse,
    isVisionModel: boolean
  ) => ChatCompletionMessageParam | MessageParam | Content | OpenAI.Responses.EasyInputMessage,
  mcpTools?: MCPTool[],
  isVisionModel: boolean = false
): Promise<(ChatCompletionMessageParam | MessageParam | Content | OpenAI.Responses.EasyInputMessage)[]> {
  const toolResults: (ChatCompletionMessageParam | MessageParam | Content | OpenAI.Responses.EasyInputMessage)[] = []
  // process tool use
  const tools = parseToolUse(content, mcpTools || [])
  if (!tools || tools.length === 0) {
    return toolResults
  }
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i]
    upsertMCPToolResponse(toolResponses, { id: `${tool.id}-${idx}-${i}`, tool: tool.tool, status: 'invoking' }, onChunk)
  }

  const toolPromises = tools.map(async (tool, i) => {
    const images: string[] = []
    const toolCallResponse = await callMCPTool(tool.tool)
    upsertMCPToolResponse(
      toolResponses,
      { id: `${tool.id}-${idx}-${i}`, tool: tool.tool, status: 'done', response: toolCallResponse },
      onChunk
    )

    for (const content of toolCallResponse.content) {
      if (content.type === 'image' && content.data) {
        images.push(`data:${content.mimeType};base64,${content.data}`)
      }
    }

    if (images.length) {
      onChunk({
        type: ChunkType.IMAGE_CREATED
      })
      onChunk({
        type: ChunkType.IMAGE_COMPLETE,
        image: {
          type: 'base64',
          images: images
        }
      })
    }

    return convertToMessage(tool.tool.id, toolCallResponse, isVisionModel)
  })

  toolResults.push(...(await Promise.all(toolPromises)))
  return toolResults
}

export function mcpToolCallResponseToOpenAICompatibleMessage(
  toolCallId: string,
  resp: MCPCallToolResponse,
  isVisionModel: boolean = false
): ChatCompletionMessageParam {
  const message = {
    role: 'user'
  } as ChatCompletionMessageParam

  if (resp.isError) {
    message.content = JSON.stringify(resp.content)
  } else {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: `Here is the result of tool call ${toolCallId}:`
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
  toolCallId: string,
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
        text: `Here is the result of tool call ${toolCallId}:`
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
  toolCallId: string,
  resp: MCPCallToolResponse,
  isVisionModel: boolean = false
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
        text: `Here is the result of tool call ${toolCallId}:`
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
  toolCallId: string,
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
        text: `Here is the result of tool call ${toolCallId}:`
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
