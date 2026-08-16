import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runExecCode } from '@main/ai/tools/codeMode/runtime'
import { toolsToTypeScript, toolToTypeScript } from '@main/ai/tools/codeMode/schemaToTypeScript'
import { PI_TOOL_EXEC_TOOL_NAME, PI_TOOL_SEARCH_TOOL_NAME } from '@shared/ai/piBuiltinTools'

import type { PiToolAuthorizer } from './approvalExtension'

type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>

const SEARCH_RESULT_LIMIT = 20

const searchParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Case-insensitive substring matched against tool names and descriptions.'
    }
  },
  additionalProperties: false
} as ToolDefinition['parameters']

const execParameters = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description:
        'JavaScript body executed inside an async function. Call tools with tools.invoke(name, params), and explicitly return the final value.'
    }
  },
  required: ['code'],
  additionalProperties: false
} as ToolDefinition['parameters']

export function createPiCodeModeTools(
  tools: readonly ToolDefinition[],
  isDisabled: (toolName: string) => boolean,
  authorizeTool: PiToolAuthorizer
): ToolDefinition[] {
  const catalog = new Map(tools.map((tool) => [tool.name, tool]))

  const searchTool: ToolDefinition = {
    name: PI_TOOL_SEARCH_TOOL_NAME,
    label: 'Search tools',
    description:
      'Search the available tool catalog. Returns matching tools as TypeScript declarations for use with tool_exec.',
    promptSnippet: 'Search available tools and read their TypeScript signatures',
    parameters: searchParameters,
    async execute(_toolCallId, params) {
      const input = params as Record<string, unknown>
      const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : ''
      const matches = [...catalog.values()]
        .filter((tool) => !isDisabled(tool.name))
        .filter((tool) => !query || `${tool.name}\n${tool.description}`.toLowerCase().includes(query))
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          declaration: toolToTypeScript(tool.name, tool.description, tool.parameters)
        }))

      const text =
        matches.length > 0
          ? toolsToTypeScript(
              matches.map((match) => ({
                name: match.name,
                description: match.description,
                inputSchema: catalog.get(match.name)?.parameters
              }))
            )
          : 'No tools matched. Broaden the query or omit it.'
      return {
        content: [{ type: 'text', text }],
        details: { matchedNamespaces: matches.length > 0 ? [{ namespace: 'pi', tools: matches }] : [] }
      }
    }
  }

  const execTool: ToolDefinition = {
    name: PI_TOOL_EXEC_TOOL_NAME,
    label: 'Execute tool code',
    description:
      'Execute JavaScript that orchestrates discovered tools. Use tool_search first, call tools.invoke(name, params), and explicitly return the final value.',
    promptSnippet: 'Execute JavaScript that orchestrates multiple tools',
    promptGuidelines: [
      'Use tool_search before tool_exec when you do not already know the exact tool name and TypeScript signature.',
      'tool_exec runs JavaScript, not TypeScript syntax. Explicitly return the final value.'
    ],
    parameters: execParameters,
    async execute(toolCallId, params, signal) {
      const input = params as Record<string, unknown>
      const code = typeof input.code === 'string' ? input.code : ''
      const result = await runExecCode(code, {
        abortSignal: signal,
        async executeTool(name, input, requestId, childSignal) {
          const tool = catalog.get(name)
          if (!tool) throw new Error(`Tool not found: ${name}`)
          const nestedToolCallId = `${toolCallId}::exec::${requestId}`
          const decision = await authorizeTool({
            toolName: name,
            toolCallId: nestedToolCallId,
            input,
            signal: childSignal
          })
          if (decision?.block) throw new Error(decision.reason)
          return tool.execute(nestedToolCallId, input, childSignal, undefined, {} as never)
        }
      })

      return toPiResult(result)
    }
  }

  return [searchTool, execTool]
}

function toPiResult(result: { result: unknown; logs?: string[]; error?: string; isError?: boolean }): ToolResult {
  if (result.isError) {
    throw new Error(result.error ?? 'tool_exec failed')
  }

  const output = stringifyOutput({
    result: result.result,
    ...(result.logs && result.logs.length > 0 ? { logs: result.logs } : {})
  })
  return {
    content: [{ type: 'text', text: output ?? 'undefined' }],
    details: { result: result.result, logs: result.logs }
  }
}

function stringifyOutput(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nested) => (typeof nested === 'bigint' ? nested.toString() : nested), 2)
  } catch {
    return String(value)
  }
}
