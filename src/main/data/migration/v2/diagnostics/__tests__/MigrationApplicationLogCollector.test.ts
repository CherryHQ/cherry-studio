import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_MIGRATION_DIAGNOSTIC_LOG_FILES,
  MAX_MIGRATION_DIAGNOSTIC_RAW_LOG_BYTES,
  MigrationApplicationLogCollector
} from '../MigrationApplicationLogCollector'

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
      writeFile(join(logsDirectory, 'app.2026-07-21.log.5.tmp'), 'fake suffix'),
      mkdir(join(logsDirectory, 'app.2026-07-21.log.3'))
    ])
    await symlink(join(logsDirectory, 'app.2026-07-21.log.1'), join(logsDirectory, 'app.2026-07-21.log.4'))

    const mtimes: Record<string, number> = {
      'app.2026-07-21.log': 100,
      'app.2026-07-21.log.1': 300,
      'app.2026-07-21.log.2': 200
    }
    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      statFile: async (filePath) => ({ ...(await stat(filePath)), mtimeMs: mtimes[basename(filePath)] })
    }).collect()

    expect(result).toEqual({
      status: 'included',
      completeness: 'complete',
      includedRawBytes: 10,
      omittedEntries: [],
      entries: [
        {
          fileName: 'app.2026-07-21.log.1',
          filePath: join(logsDirectory, 'app.2026-07-21.log.1'),
          mtimeMs: 300,
          snapshotBytes: 3
        },
        {
          fileName: 'app.2026-07-21.log.2',
          filePath: join(logsDirectory, 'app.2026-07-21.log.2'),
          mtimeMs: 200,
          snapshotBytes: 3
        },
        {
          fileName: 'app.2026-07-21.log',
          filePath: join(logsDirectory, 'app.2026-07-21.log'),
          mtimeMs: 100,
          snapshotBytes: 4
        }
      ]
    })
  })

  it('caps selection at four files and 40 MiB while recording omissions', async () => {
    const fileNames = Array.from({ length: 5 }, (_, index) => `app.2026-07-21.log.${index + 1}`)
    await Promise.all(fileNames.map((fileName) => writeFile(join(logsDirectory, fileName), 'x')))
    const MiB = 1024 * 1024
    const sizes = [25 * MiB, 20 * MiB, 10 * MiB, 4 * MiB, 1 * MiB]

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      statFile: async (filePath) => {
        const index = fileNames.indexOf(basename(filePath))
        return { size: sizes[index], mtimeMs: 500 - index }
      }
    }).collect()

    expect(MAX_MIGRATION_DIAGNOSTIC_LOG_FILES).toBe(4)
    expect(MAX_MIGRATION_DIAGNOSTIC_RAW_LOG_BYTES).toBe(40 * MiB)
    expect(result).toMatchObject({
      status: 'included',
      completeness: 'partial',
      includedRawBytes: 40 * MiB,
      entries: [
        { fileName: fileNames[0], snapshotBytes: 25 * MiB },
        { fileName: fileNames[2], snapshotBytes: 10 * MiB },
        { fileName: fileNames[3], snapshotBytes: 4 * MiB },
        { fileName: fileNames[4], snapshotBytes: 1 * MiB }
      ],
      omittedEntries: [{ fileName: fileNames[1], snapshotBytes: 20 * MiB, reason: 'budget_exceeded' }]
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

  it('preserves a stat error and absolute path before any stream is opened', async () => {
    await writeFile(join(logsDirectory, 'app.2026-07-21.log'), 'base')
    const statError = Object.assign(new Error('unreadable'), {
      stack: 'Error: unreadable\n    at statLogs (/app/main.js:42:7)',
      code: 'EACCES',
      syscall: 'stat'
    })

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      statFile: vi.fn(async () => {
        throw statError
      })
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
        syscall: 'stat',
        path: logPath
      }
    })
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
