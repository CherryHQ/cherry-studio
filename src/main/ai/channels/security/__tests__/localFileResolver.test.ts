import type * as FsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, open, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readCanonicalLocalFile, resolveLocalFile } from '../localFileResolver'

// Wrap only `open` as a spy so a single test can simulate a file growing between
// fstat and read; every other fs call (and open by default) stays real.
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof FsPromises>()
  return { ...actual, open: vi.fn(actual.open) }
})

describe('resolveLocalFile', () => {
  let base: string
  let outside: string

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'lfr-base-'))
    outside = await mkdtemp(path.join(tmpdir(), 'lfr-out-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('reads a file relative to the base path into a FileAttachment', async () => {
    await writeFile(path.join(base, 'note.md'), 'hello world')

    const file = await resolveLocalFile(base, 'note.md')

    expect(file.filename).toBe('note.md')
    expect(file.media_type).toBe('text/markdown')
    expect(file.size).toBe(Buffer.byteLength('hello world'))
    expect(Buffer.from(file.data, 'base64').toString()).toBe('hello world')
  })

  it('infers image MIME types', async () => {
    await writeFile(path.join(base, 'pic.PNG'), 'x')
    const file = await resolveLocalFile(base, 'pic.PNG')
    expect(file.media_type).toBe('image/png')
  })

  it('falls back to octet-stream for unknown extensions', async () => {
    await writeFile(path.join(base, 'blob.xyz'), 'x')
    const file = await resolveLocalFile(base, 'blob.xyz')
    expect(file.media_type).toBe('application/octet-stream')
  })

  // The resolver owns file safety, not authorization: paths that leave the base path are
  // the caller's policy question. Callers that need containment check it themselves and
  // read through `readCanonicalLocalFile`.
  it('reads an absolute path outside the base path', async () => {
    const target = path.join(outside, 'report.txt')
    await writeFile(target, 'outside')

    const file = await resolveLocalFile(base, target)
    expect(file.filename).toBe('report.txt')
    expect(Buffer.from(file.data, 'base64').toString()).toBe('outside')
  })

  it('follows "../" and symlinks that leave the base path', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    await symlink(path.join(outside, 'secret.txt'), path.join(base, 'link.txt'))
    const traversal = path.relative(base, path.join(outside, 'secret.txt'))

    await expect(resolveLocalFile(base, traversal)).resolves.toMatchObject({ filename: 'secret.txt' })
    await expect(resolveLocalFile(base, 'link.txt')).resolves.toMatchObject({ filename: 'link.txt' })
  })

  it('rejects a non-existent file as not-found', async () => {
    await expect(resolveLocalFile(base, 'missing.txt')).rejects.toThrow(/File not found/)
  })

  it('rejects a directory as not-a-file', async () => {
    await mkdir(path.join(base, 'adir'))
    await expect(resolveLocalFile(base, 'adir')).rejects.toThrow(/Not a regular file/)
  })

  it('rejects a file larger than the size limit before reading it', async () => {
    // Sparse file via truncate — fstat reports the size without writing 100MB of bytes,
    // and the resolver checks size before reading, so no large read happens.
    const big = path.join(base, 'big.bin')
    await writeFile(big, '')
    await truncate(big, MAX_FILE_SIZE_BYTES + 1)

    await expect(resolveLocalFile(base, 'big.bin')).rejects.toThrow(/byte limit/)
  })

  it('rejects a file that grows past the limit between stat and read', async () => {
    await writeFile(path.join(base, 'growing.bin'), 'small')
    const oversize = Buffer.allocUnsafe(MAX_FILE_SIZE_BYTES + 1)
    // fstat reports a small size (passes the pre-read cap), but the read returns an
    // oversize buffer — the post-read recheck must still reject it.
    vi.mocked(open).mockResolvedValueOnce({
      stat: async () => ({ isFile: () => true, size: 5 }),
      readFile: async () => oversize,
      close: async () => {}
    } as unknown as Awaited<ReturnType<typeof open>>)

    await expect(resolveLocalFile(base, 'growing.bin')).rejects.toThrow(/byte limit/)
  })
})

describe('readCanonicalLocalFile', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'lfr-canon-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('names the attachment from the requested path and echoes the display path in errors', async () => {
    // A caller that resolved a symlink itself hands the canonical path for the read but
    // keeps the requested path for naming, so the agent sees the name it asked for.
    const target = path.join(base, 'actual.md')
    await writeFile(target, 'body')
    const requested = path.join(base, 'alias.md')
    await symlink(target, requested)

    const file = await readCanonicalLocalFile(requested, target, 'alias.md')
    expect(file.filename).toBe('alias.md')
    expect(Buffer.from(file.data, 'base64').toString()).toBe('body')

    const missing = path.join(base, 'gone.md')
    await expect(readCanonicalLocalFile(missing, missing, 'gone.md')).rejects.toThrow('File not found: gone.md')
  })
})
