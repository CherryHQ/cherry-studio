import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PathStaleVersionError } from '@main/utils/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readByPath, readChunkByPath, writeIfUnchangedByPath } from '../content'

describe('file/utils/content', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-file-content-'))
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('reads content directly by path', async () => {
    const target = path.join(tmp, 'direct.txt') as AbsoluteFilePath
    await writeFile(target, 'direct content', 'utf-8')

    const result = await readByPath(target)

    expect(result.content).toBe('direct content')
    expect(result.version.size).toBe('direct content'.length)
  })

  it('reads binary content with a consistent file version', async () => {
    const target = path.join(tmp, 'snapshot.txt') as AbsoluteFilePath
    await writeFile(target, 'hello', 'utf-8')

    const result = await readByPath(target, { encoding: 'binary' })

    expect(new TextDecoder().decode(result.content)).toBe('hello')
    expect(result.mime).toBe('text/plain')
    expect(result.version.size).toBe(5)
  })

  it('reads a byte range directly by path', async () => {
    const target = path.join(tmp, 'range.bin') as AbsoluteFilePath
    await writeFile(target, new Uint8Array([0, 1, 2, 3, 4]))

    const chunk = await readChunkByPath(target, 1, 3)

    expect(Array.from(chunk.content)).toEqual([1, 2, 3])
    expect(chunk.mime).toBe('application/octet-stream')
    expect(chunk.version.size).toBe(5)
  })

  it('returns the saved file version after a conditional write', async () => {
    const target = path.join(tmp, 'save.txt') as AbsoluteFilePath
    await writeFile(target, 'original', 'utf-8')
    const original = await readByPath(target, { encoding: 'binary' })
    const data = new TextEncoder().encode('editor change')

    const savedVersion = await writeIfUnchangedByPath(target, data, original.version)
    const saved = await readByPath(target, { encoding: 'binary' })

    expect(await readFile(target, 'utf-8')).toBe('editor change')
    expect(savedVersion).toEqual(saved.version)
  })

  it('rejects a version-checked write after the file changes externally', async () => {
    const target = path.join(tmp, 'direct.txt') as AbsoluteFilePath
    await writeFile(target, 'original', 'utf-8')
    const result = await readByPath(target, { encoding: 'binary' })
    await writeFile(target, 'external change', 'utf-8')

    await expect(
      writeIfUnchangedByPath(target, new TextEncoder().encode('editor change'), result.version)
    ).rejects.toBeInstanceOf(PathStaleVersionError)
    expect(await readFile(target, 'utf-8')).toBe('external change')
  })
})
