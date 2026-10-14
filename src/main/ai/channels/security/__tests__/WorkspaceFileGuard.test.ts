import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import type * as MainFileUtils from '@main/utils/file'
import { openReadableFileSnapshot } from '@main/utils/file'

import { resolveWorkspaceFile } from '../WorkspaceFileGuard'

// Wrap only `openReadableFileSnapshot` as a spy so a single test can simulate a file
// growing between stat and read; every other fs call (and the spy by default) stays real.
vi.mock('@main/utils/file', async (importActual) => {
  const actual = await importActual<typeof MainFileUtils>()
  return { ...actual, openReadableFileSnapshot: vi.fn(actual.openReadableFileSnapshot) }
})

describe('resolveWorkspaceFile', () => {
  let workspace: string
  let outside: string

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'wfg-ws-'))
    outside = await mkdtemp(path.join(tmpdir(), 'wfg-out-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('reads a file relative to the workspace into a FileAttachment', async () => {
    await writeFile(path.join(workspace, 'note.md'), 'hello world')

    const file = await resolveWorkspaceFile(workspace, 'note.md')

    expect(file.filename).toBe('note.md')
    expect(file.media_type).toBe('text/markdown')
    expect(file.size).toBe(Buffer.byteLength('hello world'))
    expect(Buffer.from(file.data, 'base64').toString()).toBe('hello world')
  })

  it('accepts an absolute path inside the workspace', async () => {
    await mkdir(path.join(workspace, 'sub'))
    const abs = path.join(workspace, 'sub', 'data.csv')
    await writeFile(abs, 'a,b')

    const file = await resolveWorkspaceFile(workspace, abs)
    expect(file.filename).toBe('data.csv')
    expect(file.media_type).toBe('text/csv')
  })

  it('infers image MIME types', async () => {
    await writeFile(path.join(workspace, 'pic.PNG'), 'x')
    const file = await resolveWorkspaceFile(workspace, 'pic.PNG')
    expect(file.media_type).toBe('image/png')
  })

  it('infers video MIME types for native channel delivery', async () => {
    await writeFile(path.join(workspace, 'clip.mp4'), 'x')
    const file = await resolveWorkspaceFile(workspace, 'clip.mp4')
    expect(file.media_type).toBe('video/mp4')
  })

  it('falls back to octet-stream for unknown extensions', async () => {
    await writeFile(path.join(workspace, 'blob.xyz'), 'x')
    const file = await resolveWorkspaceFile(workspace, 'blob.xyz')
    expect(file.media_type).toBe('application/octet-stream')
  })

  it('rejects a "../" escape', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    const rel = path.relative(workspace, path.join(outside, 'secret.txt'))

    await expect(resolveWorkspaceFile(workspace, rel)).rejects.toThrow(/outside the workspace/)
  })

  it('rejects a sibling directory that shares the workspace path as a prefix', async () => {
    // `${workspace}-evil` starts with the workspace path but is NOT inside it; the
    // `realRoot + path.sep` boundary is what stops a naive startsWith from matching it.
    const evilDir = `${workspace}-evil`
    await mkdir(evilDir)
    const evilFile = path.join(evilDir, 'secret.txt')
    await writeFile(evilFile, 'top secret')

    try {
      await expect(resolveWorkspaceFile(workspace, evilFile)).rejects.toThrow(/outside the workspace/)
    } finally {
      await rm(evilDir, { recursive: true, force: true })
    }
  })

  it('rejects a symlink that points outside the workspace', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'link.txt'))

    await expect(resolveWorkspaceFile(workspace, 'link.txt')).rejects.toThrow(/outside the workspace/)
  })

  it('rejects a non-existent file as not-found', async () => {
    await expect(resolveWorkspaceFile(workspace, 'missing.txt')).rejects.toThrow(/not found in workspace/)
  })

  it('rejects a file larger than the size limit as too-large', async () => {
    // Sparse file via truncate — fstat reports the size without writing 100MB of bytes,
    // and the guard checks size before reading, so no large read happens.
    const big = path.join(workspace, 'big.bin')
    await writeFile(big, '')
    await truncate(big, MAX_FILE_SIZE_BYTES + 1)

    await expect(resolveWorkspaceFile(workspace, 'big.bin')).rejects.toThrow(/byte limit/)
  })

  it('rejects a file that grows past the limit between stat and read', async () => {
    await writeFile(path.join(workspace, 'growing.bin'), 'small')
    const oversize = Buffer.allocUnsafe(MAX_FILE_SIZE_BYTES + 1)
    // The snapshot reports a small size (passes the pre-read cap), but the stream yields
    // an oversize buffer — the post-read recheck must still reject it.
    vi.mocked(openReadableFileSnapshot).mockResolvedValueOnce({
      dev: 1,
      ino: 1,
      modifiedAt: 0,
      size: 5,
      createReadStream: () => Readable.from([oversize]),
      close: async () => {}
    })

    await expect(resolveWorkspaceFile(workspace, 'growing.bin')).rejects.toThrow(/byte limit/)
  })

  it('rejects a directory as not-a-file', async () => {
    await mkdir(path.join(workspace, 'adir'))
    await expect(resolveWorkspaceFile(workspace, 'adir')).rejects.toThrow(/Not a regular file/)
  })
})
