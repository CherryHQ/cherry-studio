import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PathStaleVersionError } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readByPath, writeByPath, writeIfUnchangedByPath } from '../content'

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

  it('writes content directly by path', async () => {
    const target = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(target, 'old', 'utf-8')

    const version = await writeByPath(target, 'new-content')

    expect(await readFile(target, 'utf-8')).toBe('new-content')
    expect(version.size).toBe('new-content'.length)
  })

  it('rejects a version-checked write after the file changes externally', async () => {
    const target = path.join(tmp, 'direct.txt') as FilePath
    await writeFile(target, 'original', 'utf-8')
    const expected = (await readByPath(target)).version
    await writeFile(target, 'external change', 'utf-8')

    await expect(writeIfUnchangedByPath(target, 'editor change', expected)).rejects.toBeInstanceOf(
      PathStaleVersionError
    )
    expect(await readFile(target, 'utf-8')).toBe('external change')
  })
})
