import { Tool, ToolUnion, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { FunctionCall, FunctionDeclaration, SchemaType, Tool as geminiToool } from '@google/generative-ai'
import { MCPTool } from '@renderer/types'
import { ChatCompletionMessageToolCall, ChatCompletionTool } from 'openai/resources'

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
  tool.inputSchema = JSON.parse(llmTool.function.arguments)
  return tool
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
  // @ts-ignore ignore type as it it unknow
  tool.inputSchema = toolUse.input
  return tool
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
  // @ts-ignore schema is not a valid property
  tool.inputSchema = fcall.args
  return tool
}
