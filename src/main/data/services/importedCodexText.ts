import { stripVTControlCharacters } from 'node:util'

import type { MessageData } from '@shared/data/types/message'

const toolTypes = new Set([
  'function_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'local_shell_call',
  'web_search_call'
])

function readableOutput(value: unknown, depth = 0): string {
  if (Array.isArray(value))
    return value
      .map((part) => {
        if (part && typeof part === 'object' && ['text', 'input_text', 'output_text'].includes(part.type))
          return readableOutput(part.text, depth)
        return '[Historical attachment]'
      })
      .join('\n\n')
  if (typeof value !== 'string') return JSON.stringify(value ?? '', null, 2)
  const text = stripVTControlCharacters(value)
  if (depth >= 4) return text
  const start = text.indexOf('{')
  const prefix = text.slice(0, start)
  if (
    start < 0 ||
    (prefix.trim() &&
      !prefix
        .trim()
        .split(/\r?\n/)
        .every((line) => /^(Warning: truncated output|Total output lines:)/.test(line)))
  )
    return text
  try {
    const result = JSON.parse(text.slice(start))
    if (
      typeof result.chunk_id === 'string' &&
      typeof result.output === 'string' &&
      (typeof result.exit_code === 'number' || typeof result.wall_time_seconds === 'number')
    )
      return (
        prefix +
        (typeof result.exit_code === 'number' ? '[Exit code: ' + result.exit_code + ']\n' : '') +
        readableOutput(result.output, depth + 1)
      )
  } catch {
    /* Ordinary tool text does not have a command-result envelope. */
  }
  return text
}

export function formatCodexTool(item: Record<string, unknown>): string {
  const type = String(item.type)
  if (type.endsWith('_output')) return '[Historical tool result]\n\n' + readableOutput(item.output)
  const name = typeof item.name === 'string' ? item.name : type
  let input = item.input ?? item.arguments ?? item.action ?? ''
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      /* Custom tools may receive source code rather than JSON. */
    }
  }
  const body =
    input && typeof input === 'object' && 'cmd' in input && typeof input.cmd === 'string'
      ? input.cmd
      : typeof input === 'string'
        ? input
        : JSON.stringify(input, null, 2)
  return '[Historical tool call: ' + name + ']\n\n' + stripVTControlCharacters(body)
}

export function isCodexContextText(text: string): boolean {
  return /^\s*<(recommended_plugins|environment_context)>/.test(text) || /^# AGENTS\.md instructions for /.test(text)
}

export function formatCodexHistoryText(text: string): string {
  const clean = stripVTControlCharacters(text)
  const legacy = /^\[Historical tool activity\]\n(\{[\s\S]*\})$/.exec(clean)
  if (legacy) {
    try {
      const item = JSON.parse(legacy[1])
      if (toolTypes.has(item.type)) return formatCodexTool(item)
    } catch {
      /* Keep malformed historical text available for inspection. */
    }
  }
  const environment = /^\s*<environment_context>([\s\S]*?)<\/environment_context>\s*$/.exec(clean)
  if (environment) {
    const fields = ['cwd', 'shell', 'current_date', 'timezone'].flatMap((name) => {
      const value = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(environment[1])?.[1]
      return value ? [name + ': ' + value] : []
    })
    return '[Historical environment]\n\n' + fields.join('\n')
  }
  const plugins = /^\s*<recommended_plugins>([\s\S]*?)<\/recommended_plugins>\s*$/.exec(clean)
  if (plugins) return '[Historical plugin context]\n\n' + plugins[1].trim()
  if (/^# AGENTS\.md instructions for /.test(clean))
    return '[Historical project instructions]\n\n' + clean.replace(/<\/?INSTRUCTIONS>/g, '').trim()
  return clean.replace(/<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>/g, (original, body: string) => {
    const entries = /<citation_entries>([\s\S]*?)<\/citation_entries>/.exec(body)?.[1].trim()
    return entries ? '[Historical references]\n\n' + entries.replace(/\|note=\[([^\]]*)\]/g, ' — $1') : original
  })
}

export function presentCodexHistory(data: MessageData): MessageData {
  return {
    ...data,
    parts: data.parts?.map((part) =>
      part.type === 'text' || part.type === 'reasoning' ? { ...part, text: formatCodexHistoryText(part.text) } : part
    )
  }
}
