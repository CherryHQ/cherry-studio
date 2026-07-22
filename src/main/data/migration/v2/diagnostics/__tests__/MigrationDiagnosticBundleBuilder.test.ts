import { mkdir, mkdtemp, open, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES } from '@shared/data/migration/v2/diagnostics'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  classifyMigrationDiagnosticArchiveSize,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'

const FIXED_CLOCK = () => new Date('2026-07-21T12:34:56.000Z')
const TEST_APPLICATION = { version: '2.0.0-test', platform: 'darwin' as const, arch: 'arm64' }

async function readZip(zipPath: string): Promise<{ names: string[]; data: Record<string, Buffer> }> {
  const zip = new StreamZip.async({ file: zipPath })
  try {
    const names = Object.keys(await zip.entries())
    const data: Record<string, Buffer> = {}
    for (const name of names) data[name] = await zip.entryData(name)
    return { names, data }
  } finally {
    await zip.close()
  }
}

describe('MigrationDiagnosticBundleBuilder', () => {
  let workDirectory: string
  let logsDirectory: string

  beforeEach(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'migration-diagnostic-bundle-'))
    logsDirectory = join(workDirectory, 'logs')
    await mkdir(logsDirectory)
  })

  afterEach(async () => {
    await rm(workDirectory, { recursive: true, force: true })
  })

  it('writes compact diagnostics and each original log as an ordered ZIP entry', async () => {
    const originalBaseLog = Buffer.from([0x00, 0xff, 0x70, 0x61, 0x74, 0x68])
    await Promise.all([
      writeFile(join(logsDirectory, 'app.2026-07-21.log'), originalBaseLog),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.2'), 'rotated two'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.1'), 'rotated one')
    ])
    await Promise.all([
      utimes(join(logsDirectory, 'app.2026-07-21.log'), 100, 100),
      utimes(join(logsDirectory, 'app.2026-07-21.log.2'), 200, 200),
      utimes(join(logsDirectory, 'app.2026-07-21.log.1'), 300, 300)
    ])
    const destination = join(workDirectory, 'diagnostics.zip')
    const builder = new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION
    })

    const result = await builder.save({
      destination,
      logsDirectory,
      context: {
        source: 'renderer',
        stage: 'error',
        errorSummary: 'Migration failed while copying records.',
        overallProgress: 42,
        migrators: [
          { id: 'settings', status: 'completed' },
          { id: 'messages', status: 'failed' }
        ],
        failure: {
          code: 'migration_engine_failed',
          origin: 'main',
          operation: 'run_migration',
          targetPath: '/absolute/cherrystudio.sqlite',
          error: {
            name: 'Error',
            message: 'Migration failed while copying records.',
            stack: 'Error: Migration failed while copying records.\n    at migrate (/app/main.js:10:3)'
          }
        },
        run: { id: 'run-42', startedAt: '2026-07-21T12:30:00.000Z', failedAt: '2026-07-21T12:31:00.000Z' },
        runtime: {
          processId: 4321,
          processStartedAt: '2026-07-21T10:00:00.000Z',
          userDataPath: '/absolute/userData'
        }
      }
    })

    expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.names).toEqual([
      'migration-diagnostics.json',
      'logs/app.2026-07-21.log.1',
      'logs/app.2026-07-21.log.2',
      'logs/app.2026-07-21.log'
    ])
    expect(archive.data['logs/app.2026-07-21.log']).toEqual(originalBaseLog)
    expect(archive.data['logs/app.2026-07-21.log.1']).toEqual(Buffer.from('rotated one'))

    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8'))).toEqual({
      formatVersion: 1,
      generatedAt: '2026-07-21T12:34:56.000Z',
      application: TEST_APPLICATION,
      runtime: {
        processId: 4321,
        processStartedAt: '2026-07-21T10:00:00.000Z',
        userDataPath: '/absolute/userData'
      },
      migration: {
        source: 'renderer',
        stage: 'error',
        errorSummary: 'Migration failed while copying records.',
        overallProgress: 42,
        migrators: [
          { id: 'settings', status: 'completed' },
          { id: 'messages', status: 'failed' }
        ],
        run: { id: 'run-42', startedAt: '2026-07-21T12:30:00.000Z', failedAt: '2026-07-21T12:31:00.000Z' },
        failure: {
          code: 'migration_engine_failed',
          origin: 'main',
          operation: 'run_migration',
          targetPath: '/absolute/cherrystudio.sqlite',
          error: {
            name: 'Error',
            message: 'Migration failed while copying records.',
            stack: 'Error: Migration failed while copying records.\n    at migrate (/app/main.js:10:3)'
          }
        }
      },
      logCollection: {
        status: 'included',
        completeness: 'complete',
        includedFiles: [
          { name: 'app.2026-07-21.log.1', bytes: 11 },
          { name: 'app.2026-07-21.log.2', bytes: 11 },
          { name: 'app.2026-07-21.log', bytes: 6 }
        ],
        omittedFileCount: 0,
        includedRawBytes: 28
      }
    })
  })

  it('uses the recorded failure day when the save day has no eligible log', async () => {
    const saveTime = new Date(2026, 6, 22, 0, 10)
    const failureTime = new Date(2026, 6, 21, 23, 50)
    await writeFile(join(logsDirectory, 'app.2026-07-21.log'), 'failure evidence')
    const destination = join(workDirectory, 'failure-day-logs.zip')

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: () => saveTime,
      applicationMetadata: TEST_APPLICATION
    }).save({
      destination,
      logsDirectory,
      context: {
        source: 'renderer',
        stage: 'error',
        run: {
          id: 'run-cross-midnight',
          startedAt: new Date(2026, 6, 21, 23, 45).toISOString(),
          failedAt: failureTime.toISOString()
        }
      }
    })

    expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.names).toEqual(['migration-diagnostics.json', 'logs/app.2026-07-21.log'])
    expect(archive.data['logs/app.2026-07-21.log']).toEqual(Buffer.from('failure evidence'))
  })

  it('still saves compact diagnostics when the daily application logs are unavailable', async () => {
    const destination = join(workDirectory, 'without-logs.zip')
    const collectionError = Object.assign(new Error('log collection failed'), {
      stack: 'Error: log collection failed\n    at collectLogs (/app/main.js:80:5)',
      code: 'EACCES',
      syscall: 'scandir',
      path: logsDirectory
    })
    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      collectApplicationLogs: async () => {
        throw collectionError
      }
    }).save({
      destination,
      logsDirectory,
      context: {
        source: 'native',
        stage: 'preboot',
        failure: {
          code: 'database_initialize_failed',
          origin: 'main',
          operation: 'initialize_database',
          error: {
            name: 'Error',
            message: 'database initialization failed',
            stack: 'Error: database initialization failed\n    at initialize (/app/main.js:20:7)',
            code: 'SQLITE_CANTOPEN',
            path: '/absolute/cherrystudio.sqlite'
          }
        }
      }
    })

    expect(result).toEqual({
      status: 'saved',
      logs: 'not_included',
      retry: 'not_suggested',
      size: 'standard'
    })
    const archive = await readZip(destination)
    expect(archive.names).toEqual(['migration-diagnostics.json'])
    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8'))).toEqual({
      formatVersion: 1,
      generatedAt: '2026-07-21T12:34:56.000Z',
      application: TEST_APPLICATION,
      migration: {
        source: 'native',
        stage: 'preboot',
        failure: {
          code: 'database_initialize_failed',
          origin: 'main',
          operation: 'initialize_database',
          error: {
            name: 'Error',
            message: 'database initialization failed',
            stack: 'Error: database initialization failed\n    at initialize (/app/main.js:20:7)',
            code: 'SQLITE_CANTOPEN',
            path: '/absolute/cherrystudio.sqlite'
          }
        }
      },
      logCollection: {
        status: 'not_included',
        completeness: 'none',
        includedFiles: [],
        omittedFileCount: 0,
        includedRawBytes: 0,
        reason: 'collector_failed',
        retry: 'not_suggested',
        path: logsDirectory,
        error: {
          name: 'Error',
          message: 'log collection failed',
          stack: 'Error: log collection failed\n    at collectLogs (/app/main.js:80:5)',
          code: 'EACCES',
          syscall: 'scandir',
          path: logsDirectory
        }
      }
    })
  })

  it('records no_eligible_logs without inventing an error stack', async () => {
    const destination = join(workDirectory, 'no-eligible-logs.zip')

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION
    }).save({
      destination,
      logsDirectory,
      context: { source: 'renderer', stage: 'error' }
    })

    expect(result).toEqual({ status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' })
    const archive = await readZip(destination)
    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8')).logCollection).toEqual({
      status: 'not_included',
      completeness: 'none',
      includedFiles: [],
      omittedFileCount: 0,
      includedRawBytes: 0,
      reason: 'no_eligible_logs',
      retry: 'suggested',
      path: logsDirectory
    })
  })

  it('accepts a 17 MiB uncompressed application log without an application-layer limit', async () => {
    await writeFile(join(logsDirectory, 'app.2026-07-21.log'), Buffer.alloc(17 * 1024 * 1024, 0x61))
    const destination = join(workDirectory, 'large-uncompressed-log.zip')

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION
    }).save({
      destination,
      logsDirectory,
      context: { source: 'renderer', stage: 'error' }
    })

    expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.data['logs/app.2026-07-21.log']).toHaveLength(17 * 1024 * 1024)
  })

  it('streams the opened snapshot when the log path is replaced before archiving', async () => {
    const logPath = join(logsDirectory, 'app.2026-07-21.log')
    const rotatedPath = join(logsDirectory, 'rotated-away.log')
    await writeFile(logPath, 'before')
    const handle = await open(logPath, 'r')
    const close = vi.spyOn(handle, 'close')
    await rename(logPath, rotatedPath)
    await writeFile(logPath, 'replacement')
    const destination = join(workDirectory, 'snapshot.zip')

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      collectApplicationLogs: async () => ({
        status: 'included',
        completeness: 'complete',
        entries: [{ fileName: 'app.2026-07-21.log', filePath: logPath, handle, mtimeMs: 1, snapshotBytes: 6 }],
        omittedEntries: [],
        includedRawBytes: 6
      })
    }).save({ destination, logsDirectory, context: { source: 'renderer', stage: 'error' } })

    expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
    expect((await readZip(destination)).data['logs/app.2026-07-21.log'].toString()).toBe('before')
    expect(close).toHaveBeenCalled()
    expect(handle.fd).toBe(-1)
  })

  it('rebuilds metadata-only diagnostics when a log becomes shorter than its snapshot', async () => {
    const logPath = join(logsDirectory, 'app.2026-07-21.log')
    await writeFile(logPath, 'log')
    const handle = await open(logPath, 'r')
    const close = vi.spyOn(handle, 'close')
    const destination = join(workDirectory, 'short-read.zip')

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      collectApplicationLogs: async () => ({
        status: 'included',
        completeness: 'complete',
        entries: [{ fileName: 'app.2026-07-21.log', filePath: logPath, handle, mtimeMs: 1, snapshotBytes: 6 }],
        omittedEntries: [],
        includedRawBytes: 6
      })
    }).save({ destination, logsDirectory, context: { source: 'renderer', stage: 'error' } })

    expect(result).toEqual({ status: 'saved', logs: 'not_included', retry: 'not_suggested', size: 'standard' })
    expect((await readZip(destination)).names).toEqual(['migration-diagnostics.json'])
    expect(close).toHaveBeenCalled()
    expect(handle.fd).toBe(-1)
  })

  it('rebuilds a basic ZIP when a selected log stream fails and removes atomic temp files', async () => {
    const logPath = join(logsDirectory, 'app.2026-07-21.log')
    await writeFile(logPath, 'log')
    const destination = join(workDirectory, 'fallback.zip')
    const handle = await open(logPath, 'r')
    const close = vi.spyOn(handle, 'close')
    const streamError = Object.assign(new Error('stream read failed'), {
      stack: 'Error: stream read failed\n    at streamLog (/app/main.js:55:9)',
      code: 'ENOENT',
      syscall: 'read'
    })

    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      collectApplicationLogs: async () => ({
        status: 'included',
        completeness: 'complete',
        entries: [{ fileName: 'app.2026-07-21.log', filePath: logPath, handle, mtimeMs: 1, snapshotBytes: 3 }],
        omittedEntries: [],
        includedRawBytes: 3
      }),
      createLogReadStream: () =>
        new Readable({
          read() {
            this.destroy(streamError)
          }
        })
    }).save({ destination, logsDirectory, context: { source: 'renderer', stage: 'error' } })

    expect(result).toEqual({ status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.names).toEqual(['migration-diagnostics.json'])
    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8')).logCollection).toEqual({
      status: 'not_included',
      completeness: 'none',
      includedFiles: [],
      omittedFileCount: 1,
      includedRawBytes: 0,
      reason: 'file_read_failed',
      retry: 'suggested',
      path: logPath,
      error: {
        name: 'Error',
        message: 'stream read failed',
        stack: 'Error: stream read failed\n    at streamLog (/app/main.js:55:9)',
        code: 'ENOENT',
        syscall: 'read',
        path: logPath
      }
    })
    expect((await readdir(workDirectory)).filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    [MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES, 'standard'],
    [MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES + 1, 'large']
  ] as const)('classifies the final ZIP size %s as %s', async (archiveSize, expectedSize) => {
    expect(classifyMigrationDiagnosticArchiveSize(archiveSize)).toBe(expectedSize)
  })

  it('uses the fixed public failure code for invalid targets and write failures', async () => {
    const builder = new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION
    })

    await expect(
      builder.save({
        destination: 'relative.zip',
        logsDirectory,
        context: { source: 'native', stage: 'preboot' }
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })
    await expect(
      builder.save({
        destination: join(workDirectory, 'missing-parent', 'write-failure.zip'),
        logsDirectory,
        context: { source: 'native', stage: 'preboot' }
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })
  })
})
