import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as fileSystem from '../fs'
import { getPathStatus } from '../pathStatus'

describe('getPathStatus', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['unprintable', 'unreadable'])('contains an %s filesystem code as inaccessible', async (kind) => {
    const failure =
      kind === 'unprintable'
        ? {
            code: {
              toString() {
                throw new Error('unprintable code')
              }
            }
          }
        : Object.defineProperty(new Error('stat failed'), 'code', {
            get() {
              throw new Error('unreadable code')
            }
          })
    vi.spyOn(fileSystem, 'stat').mockRejectedValueOnce(failure)

    await expect(getPathStatus(path.join(tmpdir(), 'unreadable-stat'))).resolves.toEqual({
      ok: false,
      reason: 'inaccessible'
    })
  })

  it('reports an existing directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))

    await expect(getPathStatus(dir)).resolves.toEqual({ ok: true, kind: 'directory' })
  })

  it('reports an existing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'hi')

    await expect(getPathStatus(file)).resolves.toEqual({ ok: true, kind: 'file' })
  })

  it('reports missing for a path that does not resolve (ENOENT)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))

    await expect(getPathStatus(path.join(root, 'nope'))).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('reports missing for ENOTDIR (a file in the middle of the path)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-path-status-'))
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'hi')

    await expect(getPathStatus(path.join(file, 'child'))).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('short-circuits a blank path to missing without touching the filesystem', async () => {
    await expect(getPathStatus('   ')).resolves.toEqual({ ok: false, reason: 'missing' })
  })

  it('reports missing for a non-absolute path (fails AbsoluteFilePathSchema, not inaccessible)', async () => {
    await expect(getPathStatus('relative/path')).resolves.toEqual({ ok: false, reason: 'missing' })
  })
})
