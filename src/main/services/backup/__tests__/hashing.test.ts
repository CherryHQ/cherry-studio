import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BackupCancelledError } from '../errors'
import { sha256File, sha256FileCancellable } from '../hashing'

let work: string
beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'backup-hash-'))
})
afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('sha256FileCancellable', () => {
  it('matches the repository SHA-256 primitive', async () => {
    const file = path.join(work, 'backup.sqlite')
    await writeFile(file, 'data')
    expect(await sha256FileCancellable(file)).toBe(await sha256File(file))
  })

  it('fails before opening a pre-cancelled input', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sha256FileCancellable(path.join(work, 'absent'), controller.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )
  })
})
