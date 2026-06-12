/**
 * fs__read contract: read-back for context-build's persisted outputs.
 * Path policy is strict root containment — allowed roots are the VFS dir
 * (always) plus a workspace root when one exists (none in chat today).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { FS_READ_TOOL_NAME } from '@shared/ai/builtinTools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFsReadToolEntry, executeFsRead } from '../FsReadTool'

let vfsRoot: string

beforeEach(() => {
  vfsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-vfs-'))
  vi.mocked(application.get).mockImplementation(() => ({ getRoot: () => vfsRoot }) as never)
})

afterEach(() => {
  fs.rmSync(vfsRoot, { recursive: true, force: true })
})

function writeVfsFile(name: string, content: string): string {
  const p = path.join(vfsRoot, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

describe('executeFsRead — path policy', () => {
  it('reads a file under the VFS root', async () => {
    const p = writeVfsFile('vfs_1.txt', 'alpha\nbeta\ngamma')
    const out = await executeFsRead({ path: p })
    expect(out.kind).toBe('text')
    if (out.kind === 'text') {
      expect(out.text).toContain('alpha')
      expect(out.text).toMatch(/^\s+1\t/) // cat -n style line numbers
      expect(out.totalLines).toBe(3)
    }
  })

  it('rejects relative paths', async () => {
    const out = await executeFsRead({ path: 'relative/file.txt' })
    expect(out).toMatchObject({ kind: 'error', code: 'relative-path' })
  })

  it('denies absolute paths outside the allowed roots', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-outside-'))
    const p = path.join(outside, 'secret.txt')
    fs.writeFileSync(p, 'nope')
    const out = await executeFsRead({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('denies symlinks under the VFS root that escape it', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-read-target-'))
    const target = path.join(outside, 'real.txt')
    fs.writeFileSync(target, 'escape')
    const link = path.join(vfsRoot, 'vfs_link.txt')
    fs.symlinkSync(target, link)
    const out = await executeFsRead({ path: link })
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('returns not-found for missing files under the root', async () => {
    const out = await executeFsRead({ path: path.join(vfsRoot, 'vfs_missing.txt') })
    expect(out).toMatchObject({ kind: 'error', code: 'not-found' })
  })

  it('returns not-a-file for directories', async () => {
    const out = await executeFsRead({ path: vfsRoot })
    expect(out).toMatchObject({ kind: 'error', code: 'not-a-file' })
  })
})

describe('executeFsRead — content handling', () => {
  it('paginates with offset/limit and reports line bookkeeping', async () => {
    const p = writeVfsFile('vfs_lines.txt', Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join('\n'))
    const out = await executeFsRead({ path: p, offset: 4, limit: 3 })
    expect(out).toMatchObject({ kind: 'text', startLine: 4, endLine: 6, totalLines: 10 })
    if (out.kind === 'text') {
      expect(out.text).toContain('line-4')
      expect(out.text).not.toContain('line-7')
    }
  })

  it('rejects binary content', async () => {
    const p = path.join(vfsRoot, 'vfs_bin.txt')
    fs.writeFileSync(p, Buffer.from([0x68, 0x69, 0x00, 0x01]))
    const out = await executeFsRead({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'binary' })
  })

  it('returns output-too-large with a file-specific recommended limit', async () => {
    // 200 lines × ~1000 chars ≈ 200k chars > 100k cap
    const p = writeVfsFile('vfs_big.txt', Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'))
    const out = await executeFsRead({ path: p })
    expect(out).toMatchObject({ kind: 'error', code: 'output-too-large' })
    if (out.kind === 'error') {
      expect(out.message).toMatch(/limit: \d+/)
    }
  })

  it('honors paging on oversized files instead of erroring', async () => {
    const p = writeVfsFile('vfs_big2.txt', Array.from({ length: 200 }, () => 'x'.repeat(1000)).join('\n'))
    const out = await executeFsRead({ path: p, offset: 1, limit: 50 })
    expect(out).toMatchObject({ kind: 'text', startLine: 1, endLine: 50 })
  })
})

describe('createFsReadToolEntry', () => {
  it('is a never-deferred, truncate-exempt fs entry', () => {
    const entry = createFsReadToolEntry()
    expect(entry.name).toBe(FS_READ_TOOL_NAME)
    expect(entry.truncatable).toBe(false)
    expect(entry.defer).toBe('never')
    expect(entry.namespace).toBe('fs')
    expect(entry.applies).toBeUndefined()
  })
})

describe('executeFsRead — size caps', () => {
  it('denies .. traversal that escapes the root', async () => {
    const out = await executeFsRead({ path: path.join(vfsRoot, '..', 'sibling.txt') })
    expect(out).toMatchObject({ kind: 'error', code: 'access-denied' })
  })

  it('rejects whole-file reads above the 5MB cap but allows paging them', async () => {
    const p = path.join(vfsRoot, 'vfs_5mb.txt')
    // Write real content (not sparse) so NUL sniff doesn't fire on paged read
    fs.writeFileSync(p, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))
    const whole = await executeFsRead({ path: p })
    expect(whole).toMatchObject({ kind: 'error', code: 'too-large' })
    const paged = await executeFsRead({ path: p, offset: 1, limit: 5 })
    expect(paged.kind).toBe('text')
  })

  it('rejects any read above the absolute 50MB cap, even paged', async () => {
    const p = path.join(vfsRoot, 'vfs_51mb.txt')
    fs.writeFileSync(p, '')
    fs.truncateSync(p, 51 * 1024 * 1024)
    const out = await executeFsRead({ path: p, offset: 1, limit: 5 })
    expect(out).toMatchObject({ kind: 'error', code: 'too-large' })
  })

  it('reports offset past EOF explicitly', async () => {
    const p = writeVfsFile('vfs_short.txt', 'one\ntwo')
    const out = await executeFsRead({ path: p, offset: 100 })
    expect(out).toMatchObject({ kind: 'error', code: 'offset-out-of-range' })
  })

  it('reads an empty file as one empty line (split semantics, pinned)', async () => {
    const p = writeVfsFile('vfs_empty.txt', '')
    const out = await executeFsRead({ path: p })
    expect(out).toMatchObject({ kind: 'text', startLine: 1, endLine: 1, totalLines: 1 })
  })
})
