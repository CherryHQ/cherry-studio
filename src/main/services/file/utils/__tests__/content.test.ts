import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PathStaleVersionError } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readByPath, readSnapshotByPath, writeSnapshotIfUnchangedByPath } from '../content'

describe('file/utils/content', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-file-content-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads content directly by path', async () => {
    const target = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(target, 'direct content', 'utf-8')

    const result = await readByPath(target)

    expect(result.content).toBe('direct content')
    expect(result.version.size).toBe('direct content'.length)
  })

  it('reads a versioned byte snapshot with its content hash', async () => {
    const target = path.join(tmp, 'snapshot.txt') as FilePath
    await writeFile(target, 'hello', 'utf-8')

    const snapshot = await readSnapshotByPath(target)

    expect(new TextDecoder().decode(snapshot.content)).toBe('hello')
    expect(snapshot.contentHash).toBe('26c7827d889f6da3')
    expect(snapshot.version.size).toBe(5)
  })

  it('returns the saved snapshot version and content hash after a conditional write', async () => {
    const target = path.join(tmp, 'save.txt') as FilePath
    await writeFile(target, 'original', 'utf-8')
    const original = await readSnapshotByPath(target)
    const data = new TextEncoder().encode('editor change')

    const savedVersion = await writeSnapshotIfUnchangedByPath(target, data, original.version, original.contentHash)
    const savedSnapshot = await readSnapshotByPath(target)

    expect(await readFile(target, 'utf-8')).toBe('editor change')
    expect(savedVersion).toEqual({ contentHash: savedSnapshot.contentHash, version: savedSnapshot.version })
  })

  it('rejects a version-checked write after the file changes externally', async () => {
    const target = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(target, 'original', 'utf-8')
    const snapshot = await readSnapshotByPath(target)
    await writeFile(target, 'external change', 'utf-8')

    await expect(
      writeSnapshotIfUnchangedByPath(
        target,
        new TextEncoder().encode('editor change'),
        snapshot.version,
        snapshot.contentHash
      )
    ).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('external change')
  })
})
