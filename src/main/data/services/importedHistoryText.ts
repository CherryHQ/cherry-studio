import { stripVTControlCharacters } from 'node:util'

import type { HistorySource } from '@shared/data/types/conversationImport'
import type { MessageData } from '@shared/data/types/message'

function codeBlock(text: string, language = ''): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return fence + language + '\n' + stripVTControlCharacters(text) + '\n' + fence
}

export function formatClaudeTool(block: Record<string, unknown>, name?: string): string {
  if (block.type === 'tool_use')
    return (
      '[Historical tool call: ' +
      String(block.name ?? 'unknown') +
      ']\n\n' +
      codeBlock(JSON.stringify(block.input ?? {}, null, 2), 'json')
    )
  const content =
    typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content
            .map((part) =>
              part?.type === 'text' && typeof part.text === 'string' ? part.text : '[Historical attachment]'
            )
            .join('\n')
        : JSON.stringify(block.content ?? '', null, 2)
  return '[Historical tool result' + (name ? ': ' + name : '') + ']\n\n' + stripVTControlCharacters(content)
}

export function isClaudeLocalCommand(text: string): boolean {
  return /^\s*<(?:local-command-caveat|command-name|local-command-stdout|local-command-stderr)>/.test(text)
}

export function formatClaudeHistoryText(text: string): string {
  const clean = stripVTControlCharacters(text)
  if (/^\s*<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/.test(clean))
    return '[Historical local command notice]'
  const command =
    /^\s*<command-name>([\s\S]*?)<\/command-name>\s*<command-message>[\s\S]*?<\/command-message>\s*<command-args>([\s\S]*?)<\/command-args>\s*$/.exec(
      clean
    )
  if (command) return '[Historical local command]\n\n' + (command[1] + ' ' + command[2]).trim()
  const output = /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/.exec(clean)
  if (output) return '[Historical local command output]\n\n' + output[2]
  const legacy = /^\[Historical tool (call|result)(?:: ([^\]\n]+))?\]\n(\{[\s\S]*\})$/.exec(clean)
  if (legacy) {
    try {
      const block = JSON.parse(legacy[3])
      if (block?.type === (legacy[1] === 'call' ? 'tool_use' : 'tool_result')) return formatClaudeTool(block, legacy[2])
    } catch {
      /* Keep unrecognized historical text intact. */
    }
  }
  return clean
}

export function presentClaudeHistory(data: MessageData): MessageData {
  return {
    ...data,
    parts: data.parts?.map((part) =>
      part.type === 'text' || part.type === 'reasoning' ? { ...part, text: formatClaudeHistoryText(part.text) } : part
    )
  }
}

/** Display-only completed tools; persisted text and native continuation history stay inert. */
export function presentImportedTools(source: HistorySource, messageId: string, role: string, data: MessageData) {
  if (role === 'user') return { role, data }
  const parts = data.parts?.map((part, index) => {
    if (part.type !== 'text') return part
    const marker = /^\[Historical tool (call|result|activity)(?:: ([^\]\n]+))?\]\n+([\s\S]*)$/.exec(part.text)
    if (!marker) return part
    let name = marker[2] ?? marker[1]
    let input: unknown = marker[1] === 'call' ? { input: marker[3] } : {}
    let text = marker[1] === 'call' ? '' : marker[3]
    if (marker[1] === 'activity' && source === 'opencode') {
      try {
        const tool = JSON.parse(marker[3])
        if (tool.type !== 'tool') return part
        name = typeof tool.tool === 'string' ? tool.tool : name
        input = tool.state?.input ?? {}
        text = typeof tool.state?.output === 'string' ? tool.state.output : JSON.stringify(tool.state ?? tool, null, 2)
      } catch {
        return part
      }
    }
    return {
      type: 'dynamic-tool' as const,
      toolCallId: `history:${messageId}:${index}`,
      toolName: 'historical_tool',
      state: 'output-available' as const,
      input,
      output: { content: text ? [{ type: 'text', text }] : [] },
      callProviderMetadata: {
        cherry: { tool: { type: 'mcp', name, serverId: 'history-import', serverName: source } }
      }
    }
  })
  return {
    role:
      role === 'system' && parts?.length && parts.every((part) => part.type === 'dynamic-tool') ? 'assistant' : role,
    data: { ...data, parts }
  }
}
