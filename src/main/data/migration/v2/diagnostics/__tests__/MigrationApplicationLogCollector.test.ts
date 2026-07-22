import { mkdtemp, open, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationApplicationLogCollector } from '../MigrationApplicationLogCollector'

async function closeIncluded(result: Awaited<ReturnType<MigrationApplicationLogCollector['collect']>>): Promise<void> {
  if (result.status === 'included') await Promise.all(result.entries.map((entry) => entry.handle.close()))
}

describe('MigrationApplicationLogCollector', () => {
  let logsDirectory: string

  beforeEach(async () => {
    logsDirectory = await mkdtemp(join(tmpdir(), 'migration-application-logs-'))
  })

  afterEach(async () => {
    await rm(logsDirectory, { recursive: true, force: true })
  })

  it('returns descriptors for only regular same-day logs, newest mtime first', async () => {
    await Promise.all([
      writeFile(join(logsDirectory, 'app.2026-07-21.log'), 'base'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.1'), 'one'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.2'), 'two'),
      writeFile(join(logsDirectory, 'app-error.2026-07-21.log'), 'duplicate errors'),
      writeFile(join(logsDirectory, 'app.2026-07-20.log'), 'previous day'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.5.tmp'), 'fake suffix')
    ])
    await Promise.all([
      utimes(join(logsDirectory, 'app.2026-07-21.log'), 100, 100),
      utimes(join(logsDirectory, 'app.2026-07-21.log.1'), 300, 300),
      utimes(join(logsDirectory, 'app.2026-07-21.log.2'), 200, 200)
    ])
    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12)
    }).collect()

    expect(result).toMatchObject({
      status: 'included',
      completeness: 'complete',
      includedRawBytes: 10,
      omittedEntries: [],
      entries: [
        {
          fileName: 'app.2026-07-21.log.1',
          filePath: join(logsDirectory, 'app.2026-07-21.log.1'),
          mtimeMs: expect.any(Number),
          snapshotBytes: 3
        },
        {
          fileName: 'app.2026-07-21.log.2',
          filePath: join(logsDirectory, 'app.2026-07-21.log.2'),
          mtimeMs: expect.any(Number),
          snapshotBytes: 3
        },
        {
          fileName: 'app.2026-07-21.log',
          filePath: join(logsDirectory, 'app.2026-07-21.log'),
          mtimeMs: expect.any(Number),
          snapshotBytes: 4
        }
      ]
    })
    if (result.status === 'included') {
      expect(result.entries.every((entry) => entry.handle.fd >= 0)).toBe(true)
    }
    await closeIncluded(result)
  })

  it('includes every same-day log even when the set exceeds four files and 40 MiB', async () => {
    const fileNames = Array.from({ length: 5 }, (_, index) => `app.2026-07-21.log.${index + 1}`)
    await Promise.all(fileNames.map((fileName) => writeFile(join(logsDirectory, fileName), 'x')))
    const MiB = 1024 * 1024
    const sizes = [25 * MiB, 20 * MiB, 10 * MiB, 4 * MiB, 1 * MiB]
    await Promise.all(fileNames.map((fileName, index) => truncate(join(logsDirectory, fileName), sizes[index])))
    await Promise.all(
      fileNames.map((fileName, index) => utimes(join(logsDirectory, fileName), 500 - index, 500 - index))
    )

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12)
    }).collect()

    expect(result).toMatchObject({
      status: 'included',
      completeness: 'complete',
      includedRawBytes: 60 * MiB,
      entries: [
        { fileName: fileNames[0], snapshotBytes: 25 * MiB },
        { fileName: fileNames[1], snapshotBytes: 20 * MiB },
        { fileName: fileNames[2], snapshotBytes: 10 * MiB },
        { fileName: fileNames[3], snapshotBytes: 4 * MiB },
        { fileName: fileNames[4], snapshotBytes: 1 * MiB }
      ],
      omittedEntries: []
    })
    await closeIncluded(result)
  })

  it('falls back to metadata-only when a matching log path is a symlink', async () => {
    const target = join(logsDirectory, 'target.log')
    const link = join(logsDirectory, 'app.2026-07-21.log')
    await writeFile(target, 'secret')
    await symlink(target, link)

    await expect(
      new MigrationApplicationLogCollector({
        logsDirectory,
        clock: () => new Date(2026, 6, 21, 12)
      }).collect()
    ).resolves.toMatchObject({
      status: 'not_included',
      reason: 'file_read_failed',
      path: link,
      retry: 'not_suggested'
    })
  })

  it('returns not_included when no eligible application log exists', async () => {
    await writeFile(join(logsDirectory, 'app-error.2026-07-21.log'), 'errors only')

    await expect(
      new MigrationApplicationLogCollector({
        logsDirectory,
        clock: () => new Date(2026, 6, 21, 12)
      }).collect()
    ).resolves.toEqual({
      status: 'not_included',
      completeness: 'none',
      entries: [],
      includedRawBytes: 0,
      omittedEntries: [],
      reason: 'no_eligible_logs',
      retry: 'suggested',
      path: logsDirectory
    })
  })

  it('preserves an open error and absolute path before any stream is archived', async () => {
    await writeFile(join(logsDirectory, 'app.2026-07-21.log'), 'base')
    const statError = Object.assign(new Error('unreadable'), {
      stack: 'Error: unreadable\n    at statLogs (/app/main.js:42:7)',
      code: 'EACCES',
      syscall: 'open'
    })

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      openFile: vi.fn(async () => {
        throw statError
      }) as any
    }).collect()

    const logPath = join(logsDirectory, 'app.2026-07-21.log')
    expect(result).toEqual({
      status: 'not_included',
      completeness: 'none',
      entries: [],
      includedRawBytes: 0,
      omittedEntries: [],
      reason: 'file_read_failed',
      retry: 'not_suggested',
      path: logPath,
      error: {
        name: 'Error',
        message: 'unreadable',
        stack: 'Error: unreadable\n    at statLogs (/app/main.js:42:7)',
        code: 'EACCES',
        syscall: 'open',
        path: logPath
      }
    })
  })

  it('closes handles already opened when a later candidate cannot be opened', async () => {
    const firstPath = join(logsDirectory, 'app.2026-07-21.log.1')
    const secondPath = join(logsDirectory, 'app.2026-07-21.log.2')
    await Promise.all([writeFile(firstPath, 'one'), writeFile(secondPath, 'two')])
    const firstHandle = await open(firstPath, 'r')
    const close = vi.spyOn(firstHandle, 'close')
    let calls = 0

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      openFile: (async () => {
        calls += 1
        if (calls === 1) return firstHandle
        throw Object.assign(new Error('rotated'), { code: 'ENOENT' })
      }) as any
    }).collect()

    expect(result).toMatchObject({ status: 'not_included', reason: 'file_read_failed', retry: 'suggested' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves the scan error stack and suggests retry when the logs directory is missing', async () => {
    const missingDirectory = join(logsDirectory, 'missing')

    await expect(
      new MigrationApplicationLogCollector({
        logsDirectory: missingDirectory,
        clock: () => new Date(2026, 6, 21, 12)
      }).collect()
    ).resolves.toMatchObject({
      status: 'not_included',
      completeness: 'none',
      entries: [],
      includedRawBytes: 0,
      omittedEntries: [],
      reason: 'directory_scan_failed',
      retry: 'suggested',
      path: missingDirectory,
      error: {
        name: 'Error',
        code: 'ENOENT',
        syscall: 'scandir',
        path: missingDirectory,
        stack: expect.stringContaining('ENOENT')
      }
    })
  })
})
