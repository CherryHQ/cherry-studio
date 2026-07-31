import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'

import { resolveLocalFile } from '../localFileResolver'

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

  it('reads a file relative to the base path', async () => {
    await writeFile(path.join(base, 'note.md'), 'hello world')

    const file = await resolveLocalFile(base, 'note.md')

    expect(file.filename).toBe('note.md')
    expect(file.media_type).toBe('text/markdown')
    expect(file.size).toBe(Buffer.byteLength('hello world'))
    expect(Buffer.from(file.data, 'base64').toString()).toBe('hello world')
  })

  it('falls back to octet-stream for unknown extensions', async () => {
    await writeFile(path.join(base, 'blob.xyz'), 'x')
    expect((await resolveLocalFile(base, 'blob.xyz')).media_type).toBe('application/octet-stream')
  })

  // This resolver deliberately has NO containment boundary — callers own authorization.
  // These two cases pin that contract so a future boundary change has to update them.
  it('reads an absolute path outside the base path', async () => {
    const secret = path.join(outside, 'secret.txt')
    await writeFile(secret, 'top secret')

    expect(Buffer.from((await resolveLocalFile(base, secret)).data, 'base64').toString()).toBe('top secret')
  })

  it('follows a "../" escape and a symlink that leaves the base path', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'top secret')
    await symlink(path.join(outside, 'secret.txt'), path.join(base, 'link.txt'))
    const rel = path.relative(base, path.join(outside, 'secret.txt'))

    expect(Buffer.from((await resolveLocalFile(base, rel)).data, 'base64').toString()).toBe('top secret')
    expect(Buffer.from((await resolveLocalFile(base, 'link.txt')).data, 'base64').toString()).toBe('top secret')
  })

  it('names the attachment after the requested path, not the symlink target', async () => {
    await writeFile(path.join(outside, 'secret.conf'), 'a,b')
    await symlink(path.join(outside, 'secret.conf'), path.join(base, 'alias.csv'))

    const file = await resolveLocalFile(base, 'alias.csv')

    expect(file.filename).toBe('alias.csv')
    expect(file.media_type).toBe('text/csv')
  })

  it('rejects a non-existent file as not-found', async () => {
    await expect(resolveLocalFile(base, 'missing.txt')).rejects.toThrow(/File not found/)
  })

  it('rejects a directory as not-a-file', async () => {
    await mkdir(path.join(base, 'adir'))
    await expect(resolveLocalFile(base, 'adir')).rejects.toThrow(/Not a regular file/)
  })

  it('rejects a file larger than the size limit', async () => {
    const big = path.join(base, 'big.bin')
    await writeFile(big, '')
    await truncate(big, MAX_FILE_SIZE_BYTES + 1)

    await expect(resolveLocalFile(base, 'big.bin')).rejects.toThrow(/byte limit/)
  })

  it('rejects a path containing a null byte', async () => {
    await expect(resolveLocalFile(base, 'note\0.md')).rejects.toThrow()
  })
})
