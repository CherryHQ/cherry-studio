import { Tool, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { FunctionCall, FunctionDeclaration, SchemaType, Tool as geminiToool } from '@google/generative-ai'
import store from '@renderer/store'
import { MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { ChatCompletionMessageToolCall, ChatCompletionTool } from 'openai/resources'

import { ChunkCallbackData } from '../providers'

const supportedAttributes = [
  'type',
  'nullable',
  'required',
  'format',
  'description',
  'properties',
  'items',
  'enum',
  'anyOf',
  'oneOf',
  'allOf'
]

function filterPropertieAttributes(tool: MCPTool, filterNestedObj = false) {
  const properties = tool.inputSchema.properties
  if (!properties) {
    return {}
  }

  const ensureValidSchema = (obj: Record<string, any>, processNested: boolean): Record<string, any> => {
    const schema: Record<string, any> = {
      type: (obj.type || 'object').toLowerCase()
    }

    // Copy supported attributes
    for (const attr of supportedAttributes) {
      if (obj[attr] !== undefined) {
        if (processNested && (attr === 'properties' || attr === 'items')) {
          continue
        }
        schema[attr] = obj[attr]
      }
    }

    // Handle description
    if (obj.description) {
      schema.description = obj.description
    }

    // Handle object type
    if (schema.type === 'object') {
      if (obj.properties) {
        if (processNested) {
          schema.properties = Object.fromEntries(
            Object.entries(obj.properties).map(([key, value]) => [
              key,
              ensureValidSchema(value as Record<string, any>, true)
            ])
          )
        } else {
          schema.properties = obj.properties
        }
      } else {
        schema.properties = {
          value: {
            type: 'string',
            description: 'Default value for unspecified object'
          }
        }
      }

      // Handle required fields
      if (obj.required && Array.isArray(obj.required)) {
        schema.required = obj.required
      }
    }

    // Handle array type
    if (schema.type === 'array') {
      if (obj.items) {
        if (processNested) {
          schema.items = ensureValidSchema(obj.items, true)
        } else {
          schema.items = obj.items
        }
      } else {
        schema.items = { type: 'string' } // Default items type if not specified
      }
    }

    // Handle oneOf, anyOf, allOf
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
      if (obj[key] && Array.isArray(obj[key])) {
        if (processNested) {
          schema[key] = obj[key].map((item: any) => ensureValidSchema(item, true))
        } else {
          schema[key] = obj[key]
        }
      }
    }

    // Handle enums
    if (obj.enum && Array.isArray(obj.enum)) {
      schema.enum = obj.enum
    }

    // Handle format
    if (obj.format) {
      schema.format = obj.format
    }

    // Handle numeric constraints
    if (schema.type === 'number' || schema.type === 'integer') {
      if (obj.minimum !== undefined) schema.minimum = obj.minimum
      if (obj.maximum !== undefined) schema.maximum = obj.maximum
    }

    return schema
  }

  const processedProperties = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, ensureValidSchema(value, filterNestedObj)])
  )

  console.log('[MCP] Final processed properties:', processedProperties)
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

  const tool = mcpTools.find((mcptool) => mcptool.id === llmTool.function.name)

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

export function mcpToolsToGeminiTools(mcpTools: MCPTool[] | undefined): geminiToool[] {
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
      ...(Object.keys(properties).length > 0
        ? {
            parameters: {
              type: SchemaType.OBJECT,
              properties
            }
          }
        : {})
    }
    functions.push(functionDeclaration)
  }
  const tool: geminiToool = {
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
