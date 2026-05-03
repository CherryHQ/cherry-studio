import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createReadFileToolEntry, FS_READ_TOOL_NAME } from '../readFile'

const entry = createReadFileToolEntry()

interface ReadInput {
  path: string
  offset?: number
  limit?: number
}
type ReadOutput =
  | { kind: 'text'; text: string; startLine: number; endLine: number; totalLines: number }
  | { kind: 'error'; code: string; message: string }

function callExecute(args: ReadInput): Promise<ReadOutput> {
  const execute = entry.tool.execute as (args: ReadInput, options: ToolExecutionOptions) => Promise<ReadOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1' }
  } as ToolExecutionOptions)
}

function callToModelOutput(output: ReadOutput): { type: string; value: string } {
  const fn = (
    entry.tool as {
      toModelOutput: (opts: { toolCallId: string; input: unknown; output: ReadOutput }) => {
        type: string
        value: string
      }
    }
  ).toModelOutput
  return fn({ toolCallId: 'tc-1', input: { path: '/x' }, output })
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-read-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('fs__read entry', () => {
  it('registers under fs namespace as Read capability', () => {
    expect(entry.name).toBe(FS_READ_TOOL_NAME)
    expect(entry.namespace).toBe('fs')
    expect(entry.capability).toBe('read')
  })
})

describe('fs__read execute', () => {
  it('rejects relative paths', async () => {
    const result = await callExecute({ path: 'foo.txt' })
    expect(result).toEqual({ kind: 'error', code: 'relative-path', message: expect.stringContaining('foo.txt') })
  })

  it('returns not-found for missing files', async () => {
    const result = await callExecute({ path: path.join(tmpDir, 'missing.txt') })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('not-found')
  })

  it('returns not-a-file when path is a directory', async () => {
    const result = await callExecute({ path: tmpDir })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('not-a-file')
  })

  it('rejects binary files (null byte heuristic)', async () => {
    const filePath = path.join(tmpDir, 'image.bin')
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.code).toBe('binary')
  })

  it('returns line-numbered text for small text files', async () => {
    const filePath = path.join(tmpDir, 'hello.txt')
    await fs.writeFile(filePath, 'one\ntwo\nthree')
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.startLine).toBe(1)
      expect(result.endLine).toBe(3)
      expect(result.totalLines).toBe(3)
      expect(result.text).toContain('1\tone')
      expect(result.text).toContain('2\ttwo')
      expect(result.text).toContain('3\tthree')
    }
  })

  it('honours offset + limit pagination', async () => {
    const filePath = path.join(tmpDir, 'big.txt')
    const content = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
    await fs.writeFile(filePath, content)

    const result = await callExecute({ path: filePath, offset: 50, limit: 5 })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.startLine).toBe(50)
      expect(result.endLine).toBe(54)
      expect(result.totalLines).toBe(100)
      expect(result.text).toContain('line 50')
      expect(result.text).toContain('line 54')
      expect(result.text).not.toContain('line 55')
    }
  })

  it('returns empty page when offset beyond totalLines', async () => {
    const filePath = path.join(tmpDir, 'short.txt')
    await fs.writeFile(filePath, 'a\nb')
    const result = await callExecute({ path: filePath, offset: 100 })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text).toBe('')
      expect(result.totalLines).toBe(2)
    }
  })

  it('truncates lines longer than MAX_LINE_LENGTH', async () => {
    const filePath = path.join(tmpDir, 'long.txt')
    await fs.writeFile(filePath, 'x'.repeat(2500))
    const result = await callExecute({ path: filePath })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') {
      expect(result.text.endsWith('...')).toBe(true)
      // 2000 truncated chars + '...' suffix
      expect(result.text).toContain('x'.repeat(2000))
    }
  })

  // Note: encoding detection itself is exercised in
  // `src/main/utils/__tests__/file.test.ts` against
  // `readTextFileWithAutoEncoding`. We trust the underlying utility and
  // don't re-test chardet here — short non-UTF-8 samples are
  // probabilistically detected and would make this brittle.
})

describe('fs__read toModelOutput', () => {
  it('text without remaining → plain text block', () => {
    const out = callToModelOutput({
      kind: 'text',
      text: '     1\thello',
      startLine: 1,
      endLine: 1,
      totalLines: 1
    })
    expect(out.type).toBe('text')
    expect(out.value).toBe('     1\thello')
  })

  it('text with remaining → tail with offset hint', () => {
    const out = callToModelOutput({
      kind: 'text',
      text: '     1\ta',
      startLine: 1,
      endLine: 1,
      totalLines: 100
    })
    expect(out.type).toBe('text')
    expect(out.value).toContain('99 more')
    expect(out.value).toContain('offset=2')
  })

  it('error → error-text block', () => {
    const out = callToModelOutput({ kind: 'error', code: 'binary', message: 'oops' })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('[Error: binary]')
    expect(out.value).toContain('oops')
  })
})
