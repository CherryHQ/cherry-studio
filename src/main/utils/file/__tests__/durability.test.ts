import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  durableFileIo,
  fsyncDirectory,
  fsyncDirectorySync,
  fsyncFile,
  fsyncFileSync,
  renameOnly,
  renameOnlySync,
  unlinkAndFsyncParentSync,
  writeFileFullySync
} from '../durability'

describe('durable filesystem primitives', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cs-file-durability-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('handles short writes until every byte is persisted', () => {
    const target = path.join(root, 'full.bin')
    const bytes = Buffer.from('a complete journal payload')
    const realWrite = durableFileIo.writeSync
    const shortWrite = vi
      .spyOn(durableFileIo, 'writeSync')
      .mockImplementation((fd, data, offset, length) => realWrite(fd, data, offset, Math.min(length, 3), null))

    writeFileFullySync(target, bytes, { mode: 0o600 })

    expect(shortWrite.mock.calls.length).toBeGreaterThan(1)
    expect(readFileSync(target)).toEqual(bytes)
  })

  it('fails when a write stops making progress', () => {
    const target = path.join(root, 'stalled.bin')
    vi.spyOn(durableFileIo, 'writeSync').mockReturnValue(0)

    expect(() => writeFileFullySync(target, Buffer.from('bytes'))).toThrow(/made no progress/)
  })

  it('flushes files and directories through sync and async variants', async () => {
    const target = path.join(root, 'payload.bin')
    writeFileFullySync(target, Buffer.from('payload'))

    fsyncFileSync(target)
    fsyncDirectorySync(root)
    await fsyncFile(target)
    await fsyncDirectory(root)
  })

  it('renames without changing the payload through sync and async variants', async () => {
    const first = path.join(root, 'first')
    const second = path.join(root, 'second')
    const third = path.join(root, 'third')
    writeFileFullySync(first, Buffer.from('payload'))

    renameOnlySync(first, second)
    await renameOnly(second, third)

    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(false)
    expect(readFileSync(third, 'utf8')).toBe('payload')
  })

  it('durably unlinks once and reports an already-absent path', () => {
    const target = path.join(root, 'remove-me')
    writeFileFullySync(target, Buffer.from('payload'))

    expect(unlinkAndFsyncParentSync(target)).toBe(true)
    expect(unlinkAndFsyncParentSync(target)).toBe(false)
  })

  it('treats directory fsync as a no-op on Windows', async () => {
    if (process.platform !== 'win32') return

    fsyncDirectorySync(path.join(root, 'missing'))
    await expect(fsyncDirectory(path.join(root, 'missing'))).resolves.toBeUndefined()
  })
})
