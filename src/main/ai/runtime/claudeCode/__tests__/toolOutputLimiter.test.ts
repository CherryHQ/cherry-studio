import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { limitClaudeCodeToolOutput, TOOL_OUTPUT_CHAR_LIMIT } from '../toolOutputLimiter'

function textChars(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return value.reduce((total, item) => total + textChars(item), 0)
  if (typeof value !== 'object' || value === null) return 0
  return Object.values(value).reduce((total, item) => total + textChars(item), 0)
}

describe('limitClaudeCodeToolOutput', () => {
  let agentsDataRoot: string
  let agentDataPath: string

  beforeEach(async () => {
    agentsDataRoot = await mkdtemp(path.join(os.tmpdir(), 'cherry-agent-output-'))
    agentDataPath = path.join(agentsDataRoot, 'agent-1')
    await mkdir(agentDataPath)
  })

  afterEach(async () => {
    await rm(agentsDataRoot, { recursive: true, force: true })
  })

  it('keeps output at the threshold byte-for-byte and creates no file', async () => {
    const output = 'a'.repeat(TOOL_OUTPUT_CHAR_LIMIT)

    const result = await limitClaudeCodeToolOutput(output, agentsDataRoot, agentDataPath, 'Read', 'tool-1')

    expect(result).toBeNull()
    expect(await readdir(agentDataPath)).toEqual([])
  })

  it('spills output one character over the threshold and returns a bounded replacement', async () => {
    const output = 'a'.repeat(TOOL_OUTPUT_CHAR_LIMIT + 1)

    const result = await limitClaudeCodeToolOutput(output, agentsDataRoot, agentDataPath, 'Read', 'tool-2')

    expect(result).not.toBeNull()
    expect(result!.updatedOutput).toHaveLength(TOOL_OUTPUT_CHAR_LIMIT)
    expect(result!.updatedOutput).toContain(result!.outputPath)
    expect(result!.updatedOutput).toContain(`Original size: ${TOOL_OUTPUT_CHAR_LIMIT + 1} characters`)
    expect(await readFile(result!.outputPath, 'utf8')).toBe(output)
  })

  it('preserves structured output shape while bounding far-oversized text', async () => {
    const output = {
      stdout: 'stdout\n'.repeat(10_000),
      stderr: 'stderr\n'.repeat(10_000),
      interrupted: false,
      isImage: false
    }

    const result = await limitClaudeCodeToolOutput(output, agentsDataRoot, agentDataPath, 'Bash', 'tool-3')

    expect(result).not.toBeNull()
    expect(result!.updatedOutput).toMatchObject({ interrupted: false, isImage: false })
    expect(typeof (result!.updatedOutput as typeof output).stdout).toBe('string')
    expect(typeof (result!.updatedOutput as typeof output).stderr).toBe('string')
    expect(textChars(result!.updatedOutput)).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT)
    expect(JSON.parse(await readFile(result!.outputPath, 'utf8'))).toEqual(output)
  })

  it('does not trigger for a structured response whose text stays below the threshold', async () => {
    const output = { content: [{ type: 'text', text: 'small' }], isError: false }

    const result = await limitClaudeCodeToolOutput(
      output,
      agentsDataRoot,
      agentDataPath,
      'mcp__cherry-tools__web_fetch',
      'tool-4'
    )

    expect(result).toBeNull()
    expect(await readdir(agentDataPath)).toEqual([])
  })
})
