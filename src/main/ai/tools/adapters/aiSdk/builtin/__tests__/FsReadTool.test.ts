/**
 * fs_read contract: read-back for context-build's persisted outputs.
 * Path policy is a per-request exact-path allow-list (the persisted blobs
 * whose markers appear in the request's prompt) — no directory containment:
 * the blob directory also holds user attachments.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { FS_READ_TOOL_NAME } from '@shared/ai/builtinTools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFsReadToolEntry, executeFsRead } from '../FsReadTool'

let blobDir: string

beforeEach(() => {
  blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-blobs-'))
})

afterEach(() => {
  fs.rmSync(blobDir, { recursive: true, force: true })
})

function writeBlob(name: string, content: string): string {
  const p = path.join(blobDir, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

/** Reads with the file itself allow-listed — the normal marker-follow case. */
function read(input: { path: string; offset?: number; limit?: number }, allowed: string[] = [input.path]) {
  return executeFsRead(input, new Set(allowed))
}

describe('executeFsRead — path policy', () => {
  it('reads an allow-listed blob', async () => {
    const p = writeBlob('entry-1.txt', 'alpha\nbeta\ngamma')
    const out = await read({ path: p })
    expect(out.kind).toBe('text')
    if (out.kind === 'text') {
      expect(out.text).toContain('alpha')
      expect(out.text).toMatch(/^\s+1\t/) // cat -n style line numbers
      expect(out.totalLines).toBe(3)
    }
  })

  it('rejects relative paths', async () => {
    const out = await read({ path: 'relative/file.txt' })
    expect(out).toMatchObject({ kind: 'error', code: 'relative-path' })
  })

  it('denies everything when no allow-list is provided', async () => {
    const p = writeBlob('entry-2.txt', 'nope')
    const out = await executeFsRead({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('denies everything on an empty allow-list', async () => {
    const p = writeBlob('entry-3.txt', 'nope')
    const out = await executeFsRead({ path: p }, new Set())
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('membership is exact — a sibling file in the same directory stays denied', async () => {
    const blob = writeBlob('entry-4.txt', 'persisted body')
    const sibling = writeBlob('other-users-attachment.txt', 'not yours')
    const out = await read({ path: sibling }, [blob])
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('admits a symlink that resolves to an allow-listed blob, denies one that escapes', async () => {
    const blob = writeBlob('entry-5.txt', 'the blob')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-target-'))
    const escapeTarget = path.join(outside, 'real.txt')
    fs.writeFileSync(escapeTarget, 'escape')

    const goodLink = path.join(blobDir, 'good-link.txt')
    fs.symlinkSync(blob, goodLink)
    const admitted = await read({ path: goodLink }, [blob])
    expect(admitted.kind).toBe('text')

    const badLink = path.join(blobDir, 'bad-link.txt')
    fs.symlinkSync(escapeTarget, badLink)
    const denied = await read({ path: badLink }, [blob])
    expect(denied).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('denies .. traversal to a non-listed path', async () => {
    const blob = writeBlob('entry-6.txt', 'blob')
    const out = await read({ path: path.join(blobDir, '..', 'sibling.txt') }, [blob])
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('reports a vanished allow-listed blob as not-found, not access-denied', async () => {
    const missing = path.join(blobDir, 'entry-gone.txt')
    const out = await read({ path: missing }, [missing])
    expect(out).toMatchObject({ kind: 'error', code: 'not-found' })
  })

  it('returns not-a-file for directories', async () => {
    const out = await read({ path: blobDir }, [blobDir])
    expect(out).toMatchObject({ kind: 'error', code: 'not-a-file' })
  })
})

describe('executeFsRead — content handling', () => {
  it('paginates with offset/limit and reports line bookkeeping', async () => {
    const p = writeBlob('lines.txt', Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join('\n'))
    const out = await read({ path: p, offset: 4, limit: 3 })
    expect(out).toMatchObject({ kind: 'text', startLine: 4, endLine: 6, totalLines: 10 })
    if (out.kind === 'text') {
      expect(out.text).toContain('line-4')
      expect(out.text).not.toContain('line-7')
    }
  })

  it('rejects binary content', async () => {
    const p = path.join(blobDir, 'bin.txt')
    fs.writeFileSync(p, Buffer.from([0x68, 0x69, 0x00, 0x01]))
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'binary' })
  })

  it('reads UTF-16 text (encoding-aware sniff, not a NUL probe)', async () => {
    // UTF-16LE bytes are full of NULs; the old hand-rolled probe rejected
    // them as binary even though readTextFileWithAutoEncoding decodes them.
    const p = path.join(blobDir, 'utf16.txt')
    fs.writeFileSync(p, Buffer.from('﻿hello utf-16 world\nsecond line\n', 'utf16le'))
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'text' })
    if (out.kind === 'text') expect(out.text).toContain('hello utf-16 world')
  })

  it('returns output-too-large with a file-specific recommended limit', async () => {
    // 200 lines × ~1000 chars ≈ 200k chars > 100k cap
    const p = writeBlob('big.txt', Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'))
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'output-too-large' })
    if (out.kind === 'error') {
      expect(out.message).toMatch(/limit: \d+/)
    }
  })

  // P2-B turned the persist threshold into a user setting; fs_read's per-call
  // cap has to follow it (they are one number by design — see
  // CONTEXT_PERSIST_THRESHOLD_CHARS) instead of staying pinned to the
  // compile-time default. The cap rides the request as `toolOutputCharCap`.
  it('honors a per-request cap below the compile-time default', async () => {
    // ~20k chars: fine under the 100k default, over a 10k request cap.
    const p = writeBlob('mid.txt', Array.from({ length: 20 }, () => 'x'.repeat(1000)).join('\n'))

    const withDefault = await executeFsRead({ path: p }, new Set([p]))
    expect(withDefault).toMatchObject({ kind: 'text' })

    const withLowCap = await executeFsRead({ path: p }, new Set([p]), 10_000)
    expect(withLowCap).toMatchObject({ kind: 'error', code: 'output-too-large' })
    if (withLowCap.kind === 'error') {
      // the reported cap is the request's, not the default
      expect(withLowCap.message).toContain('10000')
      expect(withLowCap.message).toMatch(/limit: \d+/)
    }
  })

  it('honors paging on oversized files instead of erroring', async () => {
    const p = writeBlob('big2.txt', Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'))
    const out = await read({ path: p, offset: 1, limit: 50 })
    expect(out).toMatchObject({ kind: 'text', startLine: 1, endLine: 50 })
  })

  it('returns a long single line in full — no per-line truncation', async () => {
    const longLine = 'x'.repeat(5000) // > the old 2000 cap, < the per-call char cap
    const p = writeBlob('longline.txt', longLine)
    const out = await read({ path: p })
    expect(out.kind).toBe('text')
    if (out.kind === 'text') {
      expect(out.text).toContain(longLine) // whole line present
      expect(out.text).not.toContain('...') // not truncated
      expect(out.totalLines).toBe(1)
    }
  })

  it('reports a single physical line above the per-call cap as output-too-large (unpageable)', async () => {
    // One line, no newlines, larger than the per-call char cap — paging can't subdivide it.
    const p = writeBlob('hugeline.txt', 'y'.repeat(120_000))
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'output-too-large' })
    if (out.kind === 'error') {
      expect(out.message).toMatch(/single physical line/)
      expect(out.message).not.toMatch(/limit: \d+/) // no useless "lower your limit" advice
    }
  })
})

describe('createFsReadToolEntry', () => {
  it('is a never-deferred fs entry, in-flight exempt but persist-codec-bearing', () => {
    const entry = createFsReadToolEntry()
    expect(entry.name).toBe(FS_READ_TOOL_NAME)
    // Both set on purpose: truncatable:false wins the in-flight lane (the
    // active loop always sees the full page), the codec wins the persist lane.
    expect(entry.truncatable).toBe(false)
    expect(entry.codec).toBeDefined()
    expect(entry.defer).toBe('never')
    expect(entry.namespace).toBe('fs')
    expect(entry.applies).toBeUndefined()
  })

  it('its codec blobs only the text field of a text result and rejects errors', () => {
    const { codec } = createFsReadToolEntry()
    const output = { kind: 'text', text: 'page body', startLine: 1, endLine: 2, totalLines: 2 }
    expect(codec!.deflate(output)).toEqual({ skeleton: output, blobs: [{ key: '/text', text: 'page body' }] })
    expect(codec!.deflate({ kind: 'error', code: 'not-found', message: 'x' })).toBeNull()
  })
})

describe('executeFsRead — size caps', () => {
  it('rejects whole-file reads above the 5MB cap but allows paging them', async () => {
    const p = path.join(blobDir, '5mb.txt')
    // Real, multi-line content (>5MB) so paging returns small slices and the NUL
    // sniff doesn't fire. (A single >5MB physical line would be correctly
    // unpageable now — covered by the single-line output-too-large test above.)
    fs.writeFileSync(p, `${Array.from({ length: 60_000 }, () => 'a'.repeat(100)).join('\n')}\n`)
    const whole = await read({ path: p })
    expect(whole).toMatchObject({ kind: 'error', code: 'too-large' })
    const paged = await read({ path: p, offset: 1, limit: 5 })
    expect(paged.kind).toBe('text')
  })

  it('rejects any read above the absolute 50MB cap, even paged', async () => {
    const p = path.join(blobDir, '51mb.txt')
    fs.writeFileSync(p, '')
    fs.truncateSync(p, 51 * 1024 * 1024)
    const out = await read({ path: p, offset: 1, limit: 5 })
    expect(out).toMatchObject({ kind: 'error', code: 'too-large' })
  })

  it('reports offset past EOF explicitly', async () => {
    const p = writeBlob('short.txt', 'one\ntwo')
    const out = await read({ path: p, offset: 100 })
    expect(out).toMatchObject({ kind: 'error', code: 'offset-out-of-range' })
  })

  it('reads an empty file as one empty line (split semantics, pinned)', async () => {
    const p = writeBlob('empty.txt', '')
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'text', startLine: 1, endLine: 1, totalLines: 1 })
  })

  it('does not count a trailing newline as a phantom extra line', async () => {
    // "a\nb\n".split("\n") → ["a","b",""]; the trailing "" must not inflate totalLines
    // to 3 (which would tell the model to page for a non-existent line 3).
    const p = writeBlob('trailing_nl.txt', 'a\nb\n')
    const out = await read({ path: p })
    expect(out).toMatchObject({ kind: 'text', startLine: 1, endLine: 2, totalLines: 2 })
  })
})
