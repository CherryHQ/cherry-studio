import { Tool, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import {
  ArraySchema,
  BaseSchema,
  BooleanSchema,
  EnumStringSchema,
  FunctionCall,
  FunctionDeclaration,
  FunctionDeclarationSchema,
  FunctionDeclarationSchemaProperty,
  IntegerSchema,
  NumberSchema,
  ObjectSchema,
  SchemaType,
  SimpleStringSchema,
  Tool as geminiTool
} from '@google/generative-ai'
import { nanoid } from '@reduxjs/toolkit'
import store from '@renderer/store'
import { addMCPServer } from '@renderer/store/mcp'
import { MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { ChatCompletionMessageToolCall, ChatCompletionTool } from 'openai/resources'

import { ChunkCallbackData, CompletionsParams } from '../providers/AiProvider'

const ensureValidSchema = (obj: Record<string, any>): FunctionDeclarationSchemaProperty => {
  // Filter out unsupported keys for Gemini
  const filteredObj = filterUnsupportedKeys(obj)

  // Handle base schema properties
  const baseSchema = {
    description: filteredObj.description,
    nullable: filteredObj.nullable
  } as BaseSchema

  // Handle string type
  if (filteredObj.type?.toLowerCase() === SchemaType.STRING) {
    if (filteredObj.enum && Array.isArray(filteredObj.enum)) {
      return {
        ...baseSchema,
        type: SchemaType.STRING,
        format: 'enum',
        enum: filteredObj.enum as string[]
      } as EnumStringSchema
    }
    return {
      ...baseSchema,
      type: SchemaType.STRING,
      format: filteredObj.format === 'date-time' ? 'date-time' : undefined
    } as SimpleStringSchema
  }

  // Handle number type
  if (filteredObj.type?.toLowerCase() === SchemaType.NUMBER) {
    return {
      ...baseSchema,
      type: SchemaType.NUMBER,
      format: ['float', 'double'].includes(filteredObj.format) ? (filteredObj.format as 'float' | 'double') : undefined
    } as NumberSchema
  }

  // Handle integer type
  if (filteredObj.type?.toLowerCase() === SchemaType.INTEGER) {
    return {
      ...baseSchema,
      type: SchemaType.INTEGER,
      format: ['int32', 'int64'].includes(filteredObj.format) ? (filteredObj.format as 'int32' | 'int64') : undefined
    } as IntegerSchema
  }

  // Handle boolean type
  if (filteredObj.type?.toLowerCase() === SchemaType.BOOLEAN) {
    return {
      ...baseSchema,
      type: SchemaType.BOOLEAN
    } as BooleanSchema
  }

  // Handle array type
  if (filteredObj.type?.toLowerCase() === SchemaType.ARRAY) {
    return {
      ...baseSchema,
      type: SchemaType.ARRAY,
      items: filteredObj.items
        ? ensureValidSchema(filteredObj.items as Record<string, any>)
        : ({ type: SchemaType.STRING } as SimpleStringSchema),
      minItems: filteredObj.minItems,
      maxItems: filteredObj.maxItems
    } as ArraySchema
  }

  // Handle object type (default)
  const properties = filteredObj.properties
    ? Object.fromEntries(
        Object.entries(filteredObj.properties).map(([key, value]) => [
          key,
          ensureValidSchema(value as Record<string, any>)
        ])
      )
    : { _empty: { type: SchemaType.STRING } as SimpleStringSchema } // Ensure properties is never empty

  return {
    ...baseSchema,
    type: SchemaType.OBJECT,
    properties,
    required: Array.isArray(filteredObj.required) ? filteredObj.required : undefined
  } as ObjectSchema
}

function filterUnsupportedKeys(obj: Record<string, any>): Record<string, any> {
  const supportedBaseKeys = ['description', 'nullable']
  const supportedStringKeys = [...supportedBaseKeys, 'type', 'format', 'enum']
  const supportedNumberKeys = [...supportedBaseKeys, 'type', 'format']
  const supportedBooleanKeys = [...supportedBaseKeys, 'type']
  const supportedArrayKeys = [...supportedBaseKeys, 'type', 'items', 'minItems', 'maxItems']
  const supportedObjectKeys = [...supportedBaseKeys, 'type', 'properties', 'required']

  const filtered: Record<string, any> = {}

  let keysToKeep: string[]

  if (obj.type?.toLowerCase() === SchemaType.STRING) {
    keysToKeep = supportedStringKeys
  } else if (obj.type?.toLowerCase() === SchemaType.NUMBER) {
    keysToKeep = supportedNumberKeys
  } else if (obj.type?.toLowerCase() === SchemaType.INTEGER) {
    keysToKeep = supportedNumberKeys
  } else if (obj.type?.toLowerCase() === SchemaType.BOOLEAN) {
    keysToKeep = supportedBooleanKeys
  } else if (obj.type?.toLowerCase() === SchemaType.ARRAY) {
    keysToKeep = supportedArrayKeys
  } else {
    // Default to object type
    keysToKeep = supportedObjectKeys
  }

  // copy supported keys
  for (const key of keysToKeep) {
    if (obj[key] !== undefined) {
      filtered[key] = obj[key]
    }
  }

  return filtered
}

function filterPropertieAttributes(tool: MCPTool, filterNestedObj: boolean = false): Record<string, object> {
  const properties = tool.inputSchema.properties
  if (!properties) {
    return {}
  }

  // For OpenAI, we don't need to validate as strictly
  if (!filterNestedObj) {
    return properties
  }

  const processedProperties = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, ensureValidSchema(value as Record<string, any>)])
  )

  return processedProperties
}

export function mcpToolsToOpenAITools(mcpTools: MCPTool[]): Array<ChatCompletionTool> {
  return mcpTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: filterPropertieAttributes(tool)
      }
    }
  }))
}

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

export async function callMCPTool(tool: MCPTool): Promise<any> {
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

    console.log(`[MCP] Tool called: ${tool.serverName} ${tool.name}`, resp)

    if (tool.serverName === '@cherry/mcp-auto-install') {
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
          isActive: false
        }
        store.dispatch(addMCPServer(mcpServer))
      }
    }

    return resp
  } catch (e) {
    console.error(`[MCP] Error calling Tool: ${tool.serverName} ${tool.name}`, e)
    return Promise.resolve({
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error calling tool ${tool.name}: ${JSON.stringify(e)}`
        }
      ]
    })
  }
}

export function mcpToolsToAnthropicTools(mcpTools: MCPTool[]): Array<ToolUnion> {
  return mcpTools.map((tool) => {
    const t: Tool = {
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

export function mcpToolsToGeminiTools(mcpTools: MCPTool[] | undefined): geminiTool[] {
  if (!mcpTools || mcpTools.length === 0) {
    // No tools available
    return []
  }
  const functions: FunctionDeclaration[] = []

  for (const tool of mcpTools) {
    const properties = filterPropertieAttributes(tool, true)
    const functionDeclaration: FunctionDeclaration = {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties:
          Object.keys(properties).length > 0
            ? Object.fromEntries(
                Object.entries(properties).map(([key, value]) => [key, ensureValidSchema(value as Record<string, any>)])
              )
            : { _empty: { type: SchemaType.STRING } as SimpleStringSchema }
      } as FunctionDeclarationSchema
    }
    functions.push(functionDeclaration)
  }
  const tool: geminiTool = {
    functionDeclarations: functions
  }
  return [tool]
}

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
  onChunk: ({ mcpToolResponse }: ChunkCallbackData) => void
) {
  try {
    for (const ret of results) {
      if (ret.id === resp.id) {
        ret.response = resp.response
        ret.status = resp.status
        return
      }
    }
    results.push(resp)
  } finally {
    onChunk({
      text: '\n',
      mcpToolResponse: results
    })
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
  mcpTools?: MCPTool[]
): Promise<string[]> {
  const toolResults: string[] = []
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
    const toolCallResponse = await callMCPTool(tool.tool)
    const result = `
          <tool_use_result>
            <name>${tool.id}</name>
            <result>${JSON.stringify(toolCallResponse)}</result>
          </tool_use_result>
          `.trim()
    upsertMCPToolResponse(
      toolResponses,
      { id: `${tool.id}-${idx}-${i}`, tool: tool.tool, status: 'done', response: toolCallResponse },
      onChunk
    )
    return result
  })

  toolResults.push(...(await Promise.all(toolPromises)))
  return toolResults
}
