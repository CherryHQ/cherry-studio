import { Tool, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { FunctionCall, FunctionDeclaration, SchemaType, Tool as geminiToool } from '@google/generative-ai'
import { MCPServer, MCPTool, MCPToolResponse } from '@renderer/types'
import { ChatCompletionMessageToolCall, ChatCompletionTool } from 'openai/resources'

import { ChunkCallbackData } from '.'

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

function filterPropertieAttributes(tool: MCPTool) {
  const roperties = tool.inputSchema.properties
  const getSubMap = (obj: Record<string, any>, keys: string[]) => {
    return Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)))
  }

  for (const [key, val] of Object.entries(roperties)) {
    roperties[key] = getSubMap(val, supportedAttributes)
  }
  return roperties
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
  // 创建工具对象的副本，而不是直接修改原对象
  return {
    ...tool,
    inputSchema: JSON.parse(llmTool.function.arguments)
  }
}

export async function callMCPTool(tool: MCPTool): Promise<any> {
  return await window.api.mcp.callTool({
    client: tool.serverName,
    name: tool.name,
    args: tool.inputSchema
  })
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
  // 创建工具对象的副本，而不是直接修改原对象
  return {
    ...tool,
    // @ts-ignore ignore type as it it unknow
    inputSchema: toolUse.input
  }
}

export function mcpToolsToGeminiTools(mcpTools: MCPTool[] | undefined): geminiToool[] {
  if (!mcpTools) {
    return []
  }
  const functions: FunctionDeclaration[] = []

  for (const tool of mcpTools) {
    const functionDeclaration: FunctionDeclaration = {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: filterPropertieAttributes(tool)
      }
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
  // 创建工具对象的副本，而不是直接修改原对象
  return {
    ...tool,
    // @ts-ignore schema is not a valid property
    inputSchema: fcall.args
  }
}

export function upsertMCPToolResponse(
  results: MCPToolResponse[],
  resp: MCPToolResponse,
  onChunk: ({ mcpToolResponse }: ChunkCallbackData) => void
) {
  try {
    // 创建一个新数组，不修改原数组
    const newResults: MCPToolResponse[] = []
    let found = false

    // 复制原数组中的元素到新数组，如果找到匹配的工具ID则更新
    for (const item of results) {
      if (item.tool.id === resp.tool.id) {
        // 找到匹配的工具，添加更新后的对象
        newResults.push({ ...item, response: resp.response, status: resp.status })
        found = true
      } else {
        // 否则添加原对象的副本
        newResults.push({ ...item })
      }
    }

    // 如果没有找到匹配的工具ID，添加新的响应
    if (!found) {
      newResults.push({ ...resp })
    }

    // 调用回调函数，传递新数组
    onChunk({
      text: '',
      mcpToolResponse: newResults
    })
  } catch (error) {
    console.error('Error in upsertMCPToolResponse:', error)
    // 出错时仍然调用回调，但使用原数组
    onChunk({
      text: '',
      mcpToolResponse: results
    })
  }
}

export function filterMCPTools(
  mcpTools: MCPTool[] | undefined,
  enabledServers: MCPServer[] | undefined
): MCPTool[] | undefined {
  console.log('filterMCPTools', mcpTools, enabledServers)
  if (mcpTools) {
    if (enabledServers) {
      mcpTools = mcpTools.filter((t) => enabledServers.some((m) => m.name === t.serverName))
    } else {
      // TODO enabledServers 存在bug，传入一直为undefined
      // mcpTools = []
    }
  }
  return mcpTools
}
