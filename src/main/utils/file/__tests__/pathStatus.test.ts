import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatPathStatusMessage, getPathStatus } from '../pathStatus'

describe('pathStatus', () => {
  it('returns directory status for existing directories', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))

    await expect(getPathStatus(workspace)).resolves.toEqual({ ok: true, kind: 'directory' })
  })

  it('returns missing for paths that do not exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const target = path.join(root, 'missing')

    await expect(getPathStatus(target)).resolves.toMatchObject({ ok: false, reason: 'missing' })
  })

  it('folds ENOTDIR (a file in the middle of the path) into missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'i am a file, not a directory')
    // Stat-ing "<file>/child" makes a non-directory a path component → ENOTDIR.
    const target = path.join(file, 'child')

    await expect(getPathStatus(target)).resolves.toMatchObject({ ok: false, reason: 'missing' })
  })

  it('short-circuits a blank path to missing without touching the filesystem', async () => {
    await expect(getPathStatus('   ')).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('returns not-directory when a file is expected to be a directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const target = path.join(root, 'file.txt')
    await writeFile(target, 'not a directory')

    await expect(getPathStatus(target, { expectedKind: 'directory' })).resolves.toEqual({
      ok: false,
      reason: 'not-directory',
      actualKind: 'file'
    })
  })

  it('returns not-file when a directory is expected to be a file', async () => {
    const target = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))

    await expect(getPathStatus(target, { expectedKind: 'file' })).resolves.toEqual({
      ok: false,
      reason: 'not-file',
      actualKind: 'directory'
    })
  })

  it('formats generic status messages with the caller label', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const target = path.join(root, 'deleted')
    await rm(target, { recursive: true, force: true })
    const status = await getPathStatus(target)

    expect(status.ok).toBe(false)
    if (!status.ok) {
      expect(formatPathStatusMessage(target, status, 'Workspace path')).toContain(
        `Workspace path does not exist: ${target}`
      )
    }
  })
})
