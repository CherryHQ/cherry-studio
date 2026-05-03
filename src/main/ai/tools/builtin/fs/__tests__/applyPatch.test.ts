import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApplyPatchToolEntry, FS_PATCH_TOOL_NAME } from '../applyPatch'

const entry = createApplyPatchToolEntry()

interface PatchInput {
  patch: string
}
type PatchOutput =
  | {
      kind: 'applied'
      results: Array<
        | { type: 'added'; path: string; lines: number }
        | { type: 'updated'; path: string; hunksApplied: number }
        | { type: 'deleted'; path: string }
      >
    }
  | {
      kind: 'parse-error'
      message: string
    }
  | {
      kind: 'apply-error'
      reason: string
      path?: string
      hunkIndex?: number
      message: string
      actualContext?: string[]
      actualContextStart?: number
      totalLines?: number
    }

function callExecute(args: PatchInput): Promise<PatchOutput> {
  const execute = entry.tool.execute as (args: PatchInput, options: ToolExecutionOptions) => Promise<PatchOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1' }
  } as ToolExecutionOptions)
}

function callToModelOutput(output: PatchOutput): { type: string; value: string } {
  const fn = (
    entry.tool as {
      toModelOutput: (opts: { toolCallId: string; input: unknown; output: PatchOutput }) => {
        type: string
        value: string
      }
    }
  ).toModelOutput
  return fn({ toolCallId: 'tc-1', input: { patch: '' }, output })
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-patch-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('fs__patch entry', () => {
  it('registers under fs namespace as Write capability', () => {
    expect(entry.name).toBe(FS_PATCH_TOOL_NAME)
    expect(entry.namespace).toBe('fs')
    expect(entry.capability).toBe('write')
  })
})

describe('fs__patch execute — success', () => {
  it('applies a multi-op patch and returns per-file summaries', async () => {
    const newFile = path.join(tmpDir, 'new.txt')
    const updFile = path.join(tmpDir, 'upd.txt')
    const delFile = path.join(tmpDir, 'gone.txt')
    await fs.writeFile(updFile, 'a\nb\nc')
    await fs.writeFile(delFile, 'bye')

    const patch = [
      '*** Begin Patch',
      `*** Add File: ${newFile}`,
      '+hello',
      `*** Update File: ${updFile}`,
      '@@',
      ' a',
      '-b',
      '+B',
      ' c',
      `*** Delete File: ${delFile}`,
      '*** End Patch'
    ].join('\n')

    const out = await callExecute({ patch })
    expect(out.kind).toBe('applied')
    if (out.kind === 'applied') {
      expect(out.results).toEqual([
        { type: 'added', path: newFile, lines: 1 },
        { type: 'updated', path: updFile, hunksApplied: 1 },
        { type: 'deleted', path: delFile }
      ])
    }
    expect(await fs.readFile(newFile, 'utf-8')).toBe('hello')
    expect(await fs.readFile(updFile, 'utf-8')).toBe('a\nB\nc')
    await expect(fs.access(delFile)).rejects.toThrow()
  })
})

describe('fs__patch execute — failures', () => {
  it('returns parse-error for malformed envelope', async () => {
    const out = await callExecute({ patch: 'not a patch' })
    expect(out.kind).toBe('parse-error')
    if (out.kind === 'parse-error') expect(out.message).toMatch(/Begin Patch/)
  })

  it('returns apply-error with hunkIndex + actualContext + totalLines on context mismatch', async () => {
    const file = path.join(tmpDir, 'mismatch.txt')
    await fs.writeFile(file, 'one\ntwo\nthree\nfour\nfive')

    const patch = [
      '*** Begin Patch',
      `*** Update File: ${file}`,
      '@@',
      ' nope',
      '-foo',
      '+bar',
      ' nada',
      '*** End Patch'
    ].join('\n')

    const out = await callExecute({ patch })
    expect(out.kind).toBe('apply-error')
    if (out.kind === 'apply-error') {
      expect(out.reason).toBe('context-mismatch')
      expect(out.path).toBe(file)
      expect(out.hunkIndex).toBe(0)
      expect(out.totalLines).toBe(5)
      expect(out.actualContextStart).toBe(1)
      expect(out.actualContext).toEqual(['one', 'two', 'three', 'four', 'five'])
    }
    // file untouched
    expect(await fs.readFile(file, 'utf-8')).toBe('one\ntwo\nthree\nfour\nfive')
  })

  it('returns apply-error/file-exists on Add when target exists', async () => {
    const file = path.join(tmpDir, 'exists.txt')
    await fs.writeFile(file, 'original')
    const patch = ['*** Begin Patch', `*** Add File: ${file}`, '+overwrite-attempt', '*** End Patch'].join('\n')
    const out = await callExecute({ patch })
    expect(out.kind).toBe('apply-error')
    if (out.kind === 'apply-error') expect(out.reason).toBe('file-exists')
    expect(await fs.readFile(file, 'utf-8')).toBe('original')
  })
})

describe('fs__patch toModelOutput', () => {
  it('applied → text summarising every op', () => {
    const out = callToModelOutput({
      kind: 'applied',
      results: [
        { type: 'added', path: '/a.txt', lines: 3 },
        { type: 'updated', path: '/b.txt', hunksApplied: 2 },
        { type: 'deleted', path: '/c.txt' }
      ]
    })
    expect(out.type).toBe('text')
    expect(out.value).toContain('Added /a.txt (3 lines)')
    expect(out.value).toContain('Updated /b.txt (2 hunks)')
    expect(out.value).toContain('Deleted /c.txt')
  })

  it('applied with empty results → text "No changes"', () => {
    const out = callToModelOutput({ kind: 'applied', results: [] })
    expect(out.type).toBe('text')
    expect(out.value).toMatch(/no changes/i)
  })

  it('parse-error → error-text with the parser message', () => {
    const out = callToModelOutput({ kind: 'parse-error', message: 'Missing "*** Begin Patch" marker.' })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('parse-error')
    expect(out.value).toContain('Begin Patch')
  })

  it('apply-error → error-text with reason + actualContext + line numbers for retry', () => {
    const out = callToModelOutput({
      kind: 'apply-error',
      reason: 'context-mismatch',
      path: '/x.ts',
      hunkIndex: 0,
      message: 'Hunk 0 context did not match.',
      actualContext: ['line98', 'line99', 'MARKER', 'line101', 'line102'],
      actualContextStart: 98,
      totalLines: 200
    })
    expect(out.type).toBe('error-text')
    expect(out.value).toContain('context-mismatch')
    expect(out.value).toContain('/x.ts')
    expect(out.value).toContain('hunk 0')
    expect(out.value).toContain('200 lines total')
    // Window header tells the model where it's looking.
    expect(out.value).toContain('lines 98-102')
    // Each rendered line shows its 1-indexed number so the model can
    // anchor a corrected hunk precisely.
    expect(out.value).toContain('    98\tline98')
    expect(out.value).toContain('   100\tMARKER')
    expect(out.value).toContain('   102\tline102')
  })
})
