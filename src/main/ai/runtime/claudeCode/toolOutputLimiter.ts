import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'

const logger = loggerService.withContext('ClaudeCodeToolOutputLimiter')

export const TOOL_OUTPUT_CHAR_LIMIT = 20_000

export interface LimitedToolOutput {
  updatedOutput: unknown
  outputPath: string
  originalChars: number
}

function collectStrings(value: unknown, strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const child of Object.values(value)) collectStrings(child, strings)
}

function middleClip(value: string, limit: number): string {
  if (value.length <= limit) return value
  if (limit === 0) return ''
  if (limit === 1) return '…'
  const headLength = Math.ceil((limit - 1) / 2)
  return `${value.slice(0, headLength)}…${value.slice(value.length - (limit - headLength - 1))}`
}

function fairStringLimit(lengths: number[], budget: number): number {
  let low = 0
  let high = Math.max(...lengths)
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2)
    const used = lengths.reduce((total, length) => total + Math.min(length, candidate), 0)
    if (used <= budget) low = candidate
    else high = candidate - 1
  }
  return low
}

function replaceStrings(value: unknown, limit: number, notice: string, state: { noticeAdded: boolean }): unknown {
  if (typeof value === 'string') {
    if (value.length <= limit) return value
    const clipped = middleClip(value, limit)
    if (state.noticeAdded) return clipped
    state.noticeAdded = true
    return `${clipped}${notice}`
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, limit, notice, state))
  if (typeof value !== 'object' || value === null) return value

  const replaced: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) replaced[key] = replaceStrings(child, limit, notice, state)
  return replaced
}

/**
 * Spill oversized Claude Code tool output into the owning agent's data directory and return a
 * shape-preserving replacement for `PostToolUse.updatedToolOutput`. `null` means unchanged.
 */
export async function limitClaudeCodeToolOutput(
  output: unknown,
  agentsDataRoot: string,
  agentDataPath: string,
  toolName: string,
  toolUseId: string
): Promise<LimitedToolOutput | null> {
  const strings: string[] = []
  collectStrings(output, strings)
  const originalChars = strings.reduce((total, value) => total + value.length, 0)
  if (originalChars <= TOOL_OUTPUT_CHAR_LIMIT) return null

  const serialized = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  if (serialized === undefined) return null

  const outputDirectory = path.join(agentDataPath, 'tool-outputs')
  const outputPath = path.join(outputDirectory, `${randomUUID()}.txt`)
  try {
    await ensureAgentStorageDirectory(agentsDataRoot, outputDirectory)
    await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    logger.error('Failed to persist oversized tool output; keeping the original result', error as Error, {
      toolName,
      toolUseId
    })
    return null
  }

  let notice = `\n\n[Tool output truncated. Full output: ${outputPath}. Original size: ${originalChars} characters.]`
  if (notice.length > TOOL_OUTPUT_CHAR_LIMIT) notice = notice.slice(0, TOOL_OUTPUT_CHAR_LIMIT)
  const stringLimit = fairStringLimit(
    strings.map((value) => value.length),
    TOOL_OUTPUT_CHAR_LIMIT - notice.length
  )
  const updatedOutput = replaceStrings(output, stringLimit, notice, { noticeAdded: false })

  return { updatedOutput, outputPath, originalChars }
}
