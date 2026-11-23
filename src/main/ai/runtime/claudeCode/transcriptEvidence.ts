import fs from 'node:fs/promises'
import path from 'node:path'

import type { JSONObject, JSONValue } from '@ai-sdk/provider'

import { listEntries } from '../orphanSessionReclaim'
import type { AgentSessionRuntimeDriver } from '../types'

const TAIL_BYTES = 512 * 1024
const TEXT_LIMIT = 1000

function truncate(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}… [${text.length - TEXT_LIMIT} more chars]` : text
}

function jsonObject(value: JSONValue | undefined): JSONObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function textOf(content: JSONValue | undefined): string {
  if (typeof content === 'string') return content

  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      const text = jsonObject(block)?.text

      return typeof text === 'string' ? text : ''
    })
    .join('\n')
}

async function findTranscript(projectsRoot: string, sessionId: string): Promise<string | undefined> {
  for (const project of await listEntries(projectsRoot)) {
    if (!project.isDirectory()) continue
    const directory = path.join(projectsRoot, project.name)
    const match = (await listEntries(directory)).find((entry) => entry.isFile() && entry.name === `${sessionId}.jsonl`)

    if (match) return path.join(directory, match.name)
  }

  return undefined
}

async function readTailLines(file: string): Promise<string[]> {
  const handle = await fs.open(file, 'r')

  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const lines = buffer.toString('utf-8').split('\n')

    return start > 0 ? lines.slice(1) : lines
  } finally {
    await handle.close()
  }
}

/** One transcript line → the diagnostic event it carries; conversation text never leaves except error text. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Selected native fields remain unvalidated, including absent tool names; Doctor redacts these diagnostic events before use.
function projectEntry(line: string): Record<string, unknown>[] {
  let value: JSONValue

  try {
    // SAFETY: JSON.parse without a reviver constructs only JSON values; container checks follow below.
    value = JSON.parse(line) as JSONValue
  } catch {
    return []
  }

  const entry = jsonObject(value)

  if (!entry) return []
  const base = { at: entry.timestamp }

  if (entry.isSidechain) Object.assign(base, { subagent: true })

  if (entry.type === 'system') {
    const hookErrors = Array.isArray(entry.hookErrors) && entry.hookErrors.length > 0 ? entry.hookErrors : undefined

    return [
      {
        kind: 'system',
        subtype: entry.subtype,
        ...base,
        level: entry.level,
        error: entry.error,
        retryAttempt: entry.retryAttempt,
        maxRetries: entry.maxRetries,
        hookErrors,
        preventedContinuation: entry.preventedContinuation || undefined
      }
    ]
  }

  const message = jsonObject(entry.message)

  if (entry.type === 'assistant') {
    const tools = Array.isArray(message?.content)
      ? message.content.flatMap((value) => {
          const block = jsonObject(value)

          return block?.type === 'tool_use' ? [block.name] : []
        })
      : []

    const event = {
      kind: entry.isApiErrorMessage ? 'api_error_message' : 'assistant',
      ...base,
      model: message?.model,
      stopReason: message?.stop_reason
    }

    if (tools.length > 0) Object.assign(event, { tools })

    if (entry.isApiErrorMessage) Object.assign(event, { text: truncate(textOf(message?.content)) })

    return [event]
  }

  if (entry.type === 'user' && Array.isArray(message?.content)) {
    return message.content.flatMap((value) => {
      const block = jsonObject(value)

      return block?.type === 'tool_result' && block.is_error
        ? [{ kind: 'tool_error', ...base, content: truncate(textOf(block.content)) }]
        : []
    })
  }

  return []
}

/**
 * Diagnostic events from the tail of a Claude Code transcript under Cherry's config dir: API errors with
 * retry counts, synthetic error turns, failing tool results, hook errors, and the assistant/tool timeline.
 * Undefined when the token is not a session id or no transcript exists (Claude-login sessions live in `~/.claude`).
 */
export async function readClaudeTranscriptEvidence(
  projectsRoot: string,
  sessionId: string,
  maxEntries: number
): ReturnType<NonNullable<AgentSessionRuntimeDriver['readTranscriptEvidence']>> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return undefined
  const file = await findTranscript(projectsRoot, sessionId)

  if (!file) return undefined

  return (await readTailLines(file)).flatMap(projectEntry).slice(-maxEntries)
}
