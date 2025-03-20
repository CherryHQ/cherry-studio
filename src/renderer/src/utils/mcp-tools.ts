import { Tool, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { FunctionCall, FunctionDeclaration, SchemaType, Tool as geminiToool } from '@google/generative-ai'
import { MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { ChatCompletionMessageToolCall, ChatCompletionTool } from 'openai/resources'

import { ChunkCallbackData } from '../providers'

const supportedAttributes = [
  'type',
  'nullable',
  'required',
  // 'format',
  'description',
  'properties',
  'items',
  'enum',
  'anyOf'
]

function filterPropertieAttributes(tool: MCPTool, filterNestedObj = false) {
  const properties = tool.inputSchema.properties
  if (!properties) {
    return {}
  }
  const getSubMap = (obj: Record<string, any>, keys: string[]) => {
    const filtered = Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)))

    if (filterNestedObj) {
      return {
        ...filtered,
        ...(obj.type === 'object' && obj.properties
          ? {
              properties: Object.fromEntries(
                Object.entries(obj.properties).map(([k, v]) => [
                  k,
                  (v as any).type === 'object' ? getSubMap(v as Record<string, any>, keys) : v
                ])
              )
            }
          : {}),
        ...(obj.type === 'array' && obj.items?.type === 'object'
          ? {
              items: getSubMap(obj.items, keys)
            }
          : {})
      }
    }

    return filtered
  }

  for (const [key, val] of Object.entries(properties)) {
    properties[key] = getSubMap(val, supportedAttributes)
  }
  return properties
}

export function mcpToolsToOpenAITools(mcpTools: MCPTool[]): Array<ChatCompletionTool> {
  return mcpTools.map((tool) => ({
    type: 'function',
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
  if (!mcpTools) return undefined
  const tool = mcpTools.find((tool) => tool.id === llmTool.function.name)
  if (!tool) {
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
    serverName: tool.serverName,
    name: tool.name,
    description: tool.description,
    inputSchema: args
  }
}

export async function callMCPTool(tool: MCPTool): Promise<any> {
  console.log(`[MCP] Calling Tool: ${tool.serverName} ${tool.name}`, tool)
  try {
    const resp = await window.api.mcp.callTool({
      client: tool.serverName,
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
