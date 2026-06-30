import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isWorkspaceFileError, resolveWorkspaceFile, WorkspaceFileError } from '../WorkspaceFileGuard'

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

  it('falls back to octet-stream for unknown extensions', async () => {
    await writeFile(path.join(workspace, 'blob.xyz'), 'x')
    const file = await resolveWorkspaceFile(workspace, 'blob.xyz')
    expect(file.media_type).toBe('application/octet-stream')
  })

  it('rejects a "../" escape', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    const rel = path.relative(workspace, path.join(outside, 'secret.txt'))

    await expect(resolveWorkspaceFile(workspace, rel)).rejects.toMatchObject({
      name: 'WorkspaceFileError',
      reason: 'outside-workspace'
    })
  })

  it('rejects a symlink that points outside the workspace', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'link.txt'))

    await expect(resolveWorkspaceFile(workspace, 'link.txt')).rejects.toMatchObject({
      reason: 'outside-workspace'
    })
  })

  it('rejects a non-existent file as not-found', async () => {
    await expect(resolveWorkspaceFile(workspace, 'missing.txt')).rejects.toMatchObject({
      reason: 'not-found'
    })
  })

  it('rejects a file larger than the size limit as too-large', async () => {
    // Sparse file via truncate — fstat reports the size without writing 100MB of bytes,
    // and the guard checks size before reading, so no large read happens.
    const big = path.join(workspace, 'big.bin')
    await writeFile(big, '')
    await truncate(big, MAX_FILE_SIZE_BYTES + 1)

    await expect(resolveWorkspaceFile(workspace, 'big.bin')).rejects.toMatchObject({
      reason: 'too-large'
    })
  })

  it('rejects a directory as not-a-file', async () => {
    await mkdir(path.join(workspace, 'adir'))
    await expect(resolveWorkspaceFile(workspace, 'adir')).rejects.toMatchObject({
      reason: 'not-a-file'
    })
  })

  it('throws a typed error guarded by isWorkspaceFileError', async () => {
    try {
      await resolveWorkspaceFile(workspace, 'missing.txt')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isWorkspaceFileError(error)).toBe(true)
      expect(error).toBeInstanceOf(WorkspaceFileError)
    }
  })
})
