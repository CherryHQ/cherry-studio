import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashDbFile, hashDbFileSync } from '@data/db/restore/hashDbFile'

describe.each([
  { name: 'async', hashFile: hashDbFile },
  { name: 'sync', hashFile: hashDbFileSync }
])('hashDbFile ($name)', ({ hashFile }) => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-hash-db-file-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('produces the same hash for files with identical content', async () => {
    const content = Buffer.from('SQLite format 3\0'.repeat(1024))
    const a = join(tempDir, 'a.sqlite')
    const b = join(tempDir, 'b.sqlite')
    writeFileSync(a, content)
    writeFileSync(b, content)

    expect(await hashFile(a)).toBe(await hashFile(b))
  })

  it('produces a different hash when a single byte differs', async () => {
    const content = Buffer.from('SQLite format 3\0'.repeat(1024))
    const flipped = Buffer.from(content)
    flipped[flipped.length - 1] ^= 0xff
    const a = join(tempDir, 'a.sqlite')
    const b = join(tempDir, 'b.sqlite')
    writeFileSync(a, content)
    writeFileSync(b, flipped)

    expect(await hashFile(a)).not.toBe(await hashFile(b))
  })

  it('returns the SHA-256 digest of an empty file', async () => {
    const file = join(tempDir, 'empty.sqlite')
    writeFileSync(file, '')

    expect(await hashFile(file)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes the final partial chunk after multiple full chunks', async () => {
    const file = join(tempDir, 'large.sqlite')
    writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 17, 'a'))

    expect(await hashFile(file)).toBe('c2273a45bd6d19d2714b8279b1fd1123bb746e7f7f6331085fb6ecaa30164546')
  })
})
