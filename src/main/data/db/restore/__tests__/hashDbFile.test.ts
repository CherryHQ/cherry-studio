import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hashDbFile } from '@data/db/restore/hashDbFile'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('hashDbFile', () => {
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

    expect(await hashDbFile(a)).toBe(await hashDbFile(b))
  })

  it('produces a different hash when a single byte differs', async () => {
    const content = Buffer.from('SQLite format 3\0'.repeat(1024))
    const flipped = Buffer.from(content)
    flipped[flipped.length - 1] ^= 0xff
    const a = join(tempDir, 'a.sqlite')
    const b = join(tempDir, 'b.sqlite')
    writeFileSync(a, content)
    writeFileSync(b, flipped)

    expect(await hashDbFile(a)).not.toBe(await hashDbFile(b))
  })
})
