import fs from 'node:fs/promises'
import path from 'node:path'

import { listEntries } from '../orphanSessionReclaim'

const TAIL_BYTES = 512 * 1024
const TEXT_LIMIT = 1000

function truncate(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}… [${text.length - TEXT_LIMIT} more chars]` : text
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n')
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
function projectEntry(line: string): Record<string, unknown>[] {
  let entry: Record<string, any>
  try {
    entry = JSON.parse(line)
  } catch {
    return []
  }
  const base = { at: entry.timestamp, ...(entry.isSidechain ? { subagent: true } : {}) }
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
  if (entry.type === 'assistant') {
    const message = entry.message ?? {}
    const tools = Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'tool_use').map((block: any) => block.name)
      : []
    return [
      {
        kind: entry.isApiErrorMessage ? 'api_error_message' : 'assistant',
        ...base,
        model: message.model,
        stopReason: message.stop_reason,
        ...(tools.length > 0 ? { tools } : {}),
        ...(entry.isApiErrorMessage ? { text: truncate(textOf(message.content)) } : {})
      }
    ]
  }
  if (entry.type === 'user' && Array.isArray(entry.message?.content)) {
    return entry.message.content
      .filter((block: any) => block?.type === 'tool_result' && block.is_error)
      .map((block: any) => ({ kind: 'tool_error', ...base, content: truncate(textOf(block.content)) }))
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
): Promise<Record<string, unknown>[] | undefined> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return undefined
  const file = await findTranscript(projectsRoot, sessionId)
  if (!file) return undefined
  return (await readTailLines(file)).flatMap(projectEntry).slice(-maxEntries)
}
