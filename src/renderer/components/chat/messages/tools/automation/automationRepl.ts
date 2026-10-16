import { CallToolResultSchema } from '@modelcontextprotocol/core'

import type { BaseTool, McpTool } from '@renderer/types/tool'

export function getAutomationReplKind(tool: BaseTool | McpTool): 'execute' | 'reset' | undefined {
  if (tool.name === 'automation_repl' || tool.name === 'mcp__automation__js') return 'execute'
  if (tool.name === 'automation_repl_reset' || tool.name === 'mcp__automation__reset') return 'reset'
  if (tool.type === 'mcp' && 'serverId' in tool && tool.serverId === 'automation') {
    if (tool.name === 'js') return 'execute'
    if (tool.name === 'reset') return 'reset'
  }
  return undefined
}

export function parseAutomationReplOutput(response: unknown): { text: string; isError: boolean } {
  const parsed = CallToolResultSchema.safeParse(Array.isArray(response) ? { content: response } : response)
  if (!parsed.success) return { text: typeof response === 'string' ? response : '', isError: false }
  const [only] = parsed.data.content
  // Failed results arrive as one text block holding the serialized tool result.
  if (parsed.data.isError && parsed.data.content.length === 1 && only.type === 'text') {
    const inner = parseAutomationReplOutput(parseJson(only.text))
    if (inner.text) return { text: inner.text, isError: true }
  }
  return {
    text: parsed.data.content
      .flatMap((part) =>
        part.type === 'text' &&
        !(part.annotations?.audience?.includes('assistant') && !part.annotations.audience.includes('user'))
          ? [part.text]
          : []
      )
      .join('\n'),
    isError: parsed.data.isError === true
  }
}

export function formatAutomationReplOutput(text: string): string {
  try {
    const value: unknown = JSON.parse(text.startsWith('Error: ') ? text.slice(7) : text)
    if (
      text.startsWith('Error: ') &&
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof value.message === 'string'
    ) {
      return value.message
    }
    if (value && typeof value === 'object' && 'data' in value && 'text' in value) {
      const data = value.data
      if (data && typeof data === 'object' && 'snapshot' in data && typeof data.snapshot === 'string') {
        return data.snapshot
      }
      if (data && typeof data === 'object' && 'content' in data && typeof data.content === 'string') {
        return data.content
      }
      return JSON.stringify(data, null, 2) ?? text
    }
    return JSON.stringify(value, null, 2)
  } catch {
    return text
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
