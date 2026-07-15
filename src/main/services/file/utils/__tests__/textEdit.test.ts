import { chmod, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PathStaleVersionError } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readTextEditSnapshotByPath, writeTextEditIfUnchangedByPath } from '../textEdit'

describe('textEdit', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-text-edit-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('normalizes CRLF for editing and preserves CRLF, BOM, and mode on save', async () => {
    const target = path.join(tmp, 'script.txt') as FilePath
    await writeFile(target, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('first\r\nsecond\r\n')]))
    if (process.platform !== 'win32') await chmod(target, 0o755)

    const snapshot = await readTextEditSnapshotByPath(target)
    expect(snapshot.content).toBe('first\nsecond\n')
    expect(snapshot.lineEnding).toBe('crlf')
    expect(snapshot.hasBom).toBe(true)

    await writeTextEditIfUnchangedByPath(
      target,
      'changed\ncontent\n',
      snapshot.lineEnding,
      snapshot.hasBom,
      snapshot.version,
      snapshot.contentHash
    )

    const bytes = await readFile(target)
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf-8')).toBe('changed\r\ncontent\r\n')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o755)
  })

  it('keeps the original file untouched after a concurrent change', async () => {
    const target = path.join(tmp, 'conflict.txt') as FilePath
    await writeFile(target, 'first')
    const snapshot = await readTextEditSnapshotByPath(target)

    await writeFile(target, 'newer')
    const nextTime = new Date(snapshot.version.mtime + 5_000)
    await utimes(target, nextTime, nextTime)

    await expect(
      writeTextEditIfUnchangedByPath(
        target,
        'draft',
        snapshot.lineEnding,
        snapshot.hasBom,
        snapshot.version,
        snapshot.contentHash
      )
    ).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('newer')
  })

  it('rejects invalid UTF-8 and mixed line endings', async () => {
    const invalid = path.join(tmp, 'invalid.txt') as FilePath
    await writeFile(invalid, new Uint8Array([0xff, 0xfe, 0x00]))
    await expect(readTextEditSnapshotByPath(invalid)).rejects.toMatchObject({
      reason: 'encoding'
    })

    const mixed = path.join(tmp, 'mixed.txt') as FilePath
    await writeFile(mixed, 'first\r\nsecond\n')
    await expect(readTextEditSnapshotByPath(mixed)).rejects.toMatchObject({
      reason: 'mixed-line-endings'
    })
  })

  it('rejects symbolic links so atomic save cannot replace the link itself', async () => {
    if (process.platform === 'win32') return
    const real = path.join(tmp, 'real.txt')
    const linked = path.join(tmp, 'linked.txt') as FilePath
    await writeFile(real, 'content')
    await symlink(real, linked)

    await expect(readTextEditSnapshotByPath(linked)).rejects.toMatchObject({
      reason: 'symbolic-link'
    })
  })
})
