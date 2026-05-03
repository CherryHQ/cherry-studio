/**
 * RED tests for apply_patch applier.
 *
 * Spec: take a parsed Patch IR, validate against the filesystem, then
 * commit atomically. Atomicity = if any op (or hunk within an op) fails
 * validation, NO files are touched.
 *
 * Failure feedback: when a hunk's context doesn't match, return the
 * first 5 lines of the actual file at the apply point so the model can
 * adjust on retry.
 *
 * Outcome shape:
 *   { ok: true, value: ApplyResult }                — all ops applied
 *   { ok: false, error: ApplyError }                — first failure stops the run
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` is hoisted; the module is replaced with a controlled stub that
// the rollback tests below can fail on demand. Happy-path tests still get
// real-ish atomic writes (we just call writeFile under the hood).
vi.mock('write-file-atomic', () => ({
  default: async (filePath: string, data: string) => {
    writeFileAtomicCalls += 1
    if (writeFileAtomicFailAt === writeFileAtomicCalls) {
      throw new Error(`mocked: write-file-atomic failed on call ${writeFileAtomicCalls}`)
    }
    await fs.writeFile(filePath, data, 'utf-8')
  }
}))

let writeFileAtomicCalls = 0
let writeFileAtomicFailAt: number | null = null

import { applyPatch } from '../applier'
import { parsePatch } from '../parser'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-patch-test-'))
  writeFileAtomicCalls = 0
  writeFileAtomicFailAt = null
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function patchOf(...lines: string[]): string {
  return ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
}

function pathIn(rel: string): string {
  return path.join(tmpDir, rel)
}

async function parseAndApply(input: string) {
  const parsed = parsePatch(input)
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`)
  return applyPatch(parsed.value)
}

describe('applyPatch — Add', () => {
  it('creates a new file at absolute path', async () => {
    const file = pathIn('new.txt')
    const out = await parseAndApply(patchOf(`*** Add File: ${file}`, '+hello', '+world'))
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.results).toEqual([{ type: 'added', path: file, lines: 2 }])
    }
    expect(await fs.readFile(file, 'utf-8')).toBe('hello\nworld')
  })

  it('refuses Add when file already exists', async () => {
    const file = pathIn('exists.txt')
    await fs.writeFile(file, 'original')
    const out = await parseAndApply(patchOf(`*** Add File: ${file}`, '+new'))
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.reason).toBe('file-exists')
      expect(out.error.path).toBe(file)
    }
    expect(await fs.readFile(file, 'utf-8')).toBe('original')
  })

  it('rejects relative paths', async () => {
    const out = await parseAndApply(patchOf('*** Add File: rel/path.txt', '+x'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.reason).toBe('relative-path')
  })
})

describe('applyPatch — Update', () => {
  it('applies a single hunk when context matches', async () => {
    const file = pathIn('upd.txt')
    await fs.writeFile(file, 'a\nb\nc\nd\ne')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' b', '-c', '+C', ' d'))
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\nb\nC\nd\ne')
  })

  it('applies multiple hunks in order', async () => {
    const file = pathIn('multi.txt')
    await fs.writeFile(file, 'a\nb\nc\nd\ne\nf\ng')
    const out = await parseAndApply(
      patchOf(`*** Update File: ${file}`, '@@', ' a', '-b', '+B', '@@', ' e', '-f', '+F', ' g')
    )
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\nB\nc\nd\ne\nF\ng')
  })

  it('returns context-mismatch with totalLines and head fallback when no probe matches', async () => {
    const file = pathIn('mismatch.txt')
    await fs.writeFile(file, 'one\ntwo\nthree\nfour\nfive')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' nope', '-foo', '+bar', ' nada'))
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.reason).toBe('context-mismatch')
      expect(out.error.path).toBe(file)
      expect(out.error.hunkIndex).toBe(0)
      expect(out.error.totalLines).toBe(5)
      // No probe line ('nope' / 'foo' / 'nada') exists in the file → fall back
      // to the file's head, starting at line 1.
      expect(out.error.actualContext).toEqual(['one', 'two', 'three', 'four', 'five'])
      expect(out.error.actualContextStart).toBe(1)
    }
    // file untouched
    expect(await fs.readFile(file, 'utf-8')).toBe('one\ntwo\nthree\nfour\nfive')
  })

  it('returns context-mismatch with a window around the partial-match anchor in long files', async () => {
    const file = pathIn('long.txt')
    // 200 lines; line 100 is "MARKER".
    const lines = Array.from({ length: 200 }, (_, i) => (i === 99 ? 'MARKER' : `line${i + 1}`))
    await fs.writeFile(file, lines.join('\n'))
    // Hunk's first context line "MARKER" exists; next context line "WRONG"
    // does not — so the hunk fails to match consecutively, but the probe
    // pinpoints line 100 as the probable apply point.
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' MARKER', ' WRONG', '-x', '+y'))
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.reason).toBe('context-mismatch')
      expect(out.error.totalLines).toBe(200)
      // 5-line window around line 100: lines 98-102 (1-indexed).
      expect(out.error.actualContextStart).toBe(98)
      expect(out.error.actualContext).toEqual(['line98', 'line99', 'MARKER', 'line101', 'line102'])
    }
  })

  it('returns file-not-found when Update target does not exist', async () => {
    const out = await parseAndApply(patchOf(`*** Update File: ${pathIn('ghost.txt')}`, '@@', ' a', '-b', '+c'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.reason).toBe('file-not-found')
  })

  it('handles add-only hunk (no removes; pure insertion at context)', async () => {
    const file = pathIn('insert.txt')
    await fs.writeFile(file, 'a\nb\nd')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' b', '+c', ' d'))
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\nb\nc\nd')
  })

  it('handles remove-only hunk', async () => {
    const file = pathIn('remove.txt')
    await fs.writeFile(file, 'a\nb\nc\nd')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' a', '-b', ' c'))
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\nc\nd')
  })
})

describe('applyPatch — Delete', () => {
  it('removes an existing file', async () => {
    const file = pathIn('gone.txt')
    await fs.writeFile(file, 'bye')
    const out = await parseAndApply(patchOf(`*** Delete File: ${file}`))
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.results).toEqual([{ type: 'deleted', path: file }])
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('returns file-not-found when target does not exist', async () => {
    const out = await parseAndApply(patchOf(`*** Delete File: ${pathIn('nothere.txt')}`))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.reason).toBe('file-not-found')
  })
})

describe('applyPatch — read-before-write enforcement', () => {
  it('refuses ambiguous match: same context appears multiple places without anchor', async () => {
    const file = pathIn('ambig.txt')
    // "    return 1" appears twice — model didn't read enough to disambiguate.
    await fs.writeFile(file, ['def first():', '    return 1', '', 'def second():', '    return 1'].join('\n'))
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', '-    return 1', '+    return 2'))
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.reason).toBe('ambiguous-match')
      expect(out.error.matchCount).toBe(2)
    }
    // file untouched
    expect((await fs.readFile(file, 'utf-8')).split('\n').filter((l) => l === '    return 1')).toHaveLength(2)
  })

  it('uses @@ anchor to disambiguate — anchor narrows the search window', async () => {
    const file = pathIn('with-anchor.txt')
    await fs.writeFile(file, ['def first():', '    return 1', '', 'def second():', '    return 1'].join('\n'))
    const out = await parseAndApply(
      patchOf(`*** Update File: ${file}`, '@@ def second():', '-    return 1', '+    return 2')
    )
    expect(out.ok).toBe(true)
    const after = await fs.readFile(file, 'utf-8')
    // first occurrence stays untouched, second changes
    expect(after).toBe(['def first():', '    return 1', '', 'def second():', '    return 2'].join('\n'))
  })

  it('anchor not found in file → context-mismatch (cannot blindly apply)', async () => {
    const file = pathIn('no-anchor.txt')
    await fs.writeFile(file, 'foo\nbar\n')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@ def nonexistent():', '-foo', '+FOO'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.reason).toBe('context-mismatch')
  })
})

describe('applyPatch — cross-file rollback', () => {
  it('restores already-committed update when next write fails', async () => {
    const fileA = pathIn('a.txt')
    const fileB = pathIn('b.txt')
    await fs.writeFile(fileA, 'aa')
    await fs.writeFile(fileB, 'bb')

    writeFileAtomicFailAt = 2 // first write succeeds, second throws
    const out = await parseAndApply(
      patchOf(`*** Update File: ${fileA}`, '@@', '-aa', '+AA', `*** Update File: ${fileB}`, '@@', '-bb', '+BB')
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.reason).toBe('io-failure')
    // Both files restored to original — fileA was committed then rolled back,
    // fileB never got written.
    expect(await fs.readFile(fileA, 'utf-8')).toBe('aa')
    expect(await fs.readFile(fileB, 'utf-8')).toBe('bb')
  })

  it('removes added file when subsequent write fails (Add rollback = unlink)', async () => {
    const newFile = pathIn('new.txt')
    const updFile = pathIn('upd.txt')
    await fs.writeFile(updFile, 'orig')

    writeFileAtomicFailAt = 2 // Add succeeds, Update throws
    const out = await parseAndApply(
      patchOf(`*** Add File: ${newFile}`, '+hello', `*** Update File: ${updFile}`, '@@', '-orig', '+NEW')
    )
    expect(out.ok).toBe(false)
    // The added file should NOT exist after rollback.
    await expect(fs.access(newFile)).rejects.toThrow()
    // The update target should be untouched.
    expect(await fs.readFile(updFile, 'utf-8')).toBe('orig')
  })

  it('restores writes when a later delete fails', async () => {
    const updFile = pathIn('upd.txt')
    const delFile = pathIn('del.txt')
    await fs.writeFile(updFile, 'orig')
    await fs.writeFile(delFile, 'sticky')

    // Make the delete fail by spying on fs.unlink (only for the delete target).
    const realUnlink = fs.unlink
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (typeof p === 'string' && p === delFile) {
        throw new Error('mocked: unlink failed')
      }
      return realUnlink(p)
    })

    try {
      const out = await parseAndApply(
        patchOf(`*** Update File: ${updFile}`, '@@', '-orig', '+UPDATED', `*** Delete File: ${delFile}`)
      )
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error.reason).toBe('io-failure')
      // Update was committed then rolled back.
      expect(await fs.readFile(updFile, 'utf-8')).toBe('orig')
      // Delete failed; file still present with original content.
      expect(await fs.readFile(delFile, 'utf-8')).toBe('sticky')
    } finally {
      unlinkSpy.mockRestore()
    }
  })
})

describe('applyPatch — atomicity', () => {
  it('does not modify file A when a later hunk in file B fails', async () => {
    const fileA = pathIn('a.txt')
    const fileB = pathIn('b.txt')
    await fs.writeFile(fileA, 'aa\nbb\ncc')
    await fs.writeFile(fileB, 'dd\nee\nff')
    const out = await parseAndApply(
      patchOf(
        `*** Update File: ${fileA}`,
        '@@',
        ' aa',
        '-bb',
        '+BB',
        ' cc',
        `*** Update File: ${fileB}`,
        '@@',
        ' nope',
        '-ee',
        '+EE'
      )
    )
    expect(out.ok).toBe(false)
    expect(await fs.readFile(fileA, 'utf-8')).toBe('aa\nbb\ncc')
    expect(await fs.readFile(fileB, 'utf-8')).toBe('dd\nee\nff')
  })
})

describe('applyPatch — line endings', () => {
  it('preserves CRLF line endings of the target file', async () => {
    const file = pathIn('crlf.txt')
    await fs.writeFile(file, 'a\r\nb\r\nc\r\nd')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' a', '-b', '+B', ' c'))
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\r\nB\r\nc\r\nd')
  })

  it('preserves LF line endings of the target file', async () => {
    const file = pathIn('lf.txt')
    await fs.writeFile(file, 'a\nb\nc\nd')
    const out = await parseAndApply(patchOf(`*** Update File: ${file}`, '@@', ' a', '-b', '+B', ' c'))
    expect(out.ok).toBe(true)
    expect(await fs.readFile(file, 'utf-8')).toBe('a\nB\nc\nd')
  })
})

describe('applyPatch — empty patch', () => {
  it('returns ok with no results when ops list is empty', async () => {
    const out = await parseAndApply('*** Begin Patch\n*** End Patch')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value.results).toEqual([])
  })
})
