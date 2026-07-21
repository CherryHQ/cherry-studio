import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES } from '@shared/data/migration/v2/diagnostics'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MigrationDiagnosticBundleBuilder } from '../MigrationDiagnosticBundleBuilder'

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

  it('writes compact diagnostics, bilingual README, and each original log as an ordered ZIP entry', async () => {
    const originalBaseLog = Buffer.from([0x00, 0xff, 0x70, 0x61, 0x74, 0x68])
    await Promise.all([
      writeFile(join(logsDirectory, 'app.2026-07-21.log'), originalBaseLog),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.2'), 'rotated two'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.1'), 'rotated one')
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
        failureCode: 'migration_failed',
        errorSummary: 'Migration failed while copying records.',
        overallProgress: 42,
        migrators: [
          { id: 'settings', status: 'completed' },
          { id: 'messages', status: 'failed' }
        ]
      }
    })

    expect(result).toEqual({ status: 'saved', logs: 'included', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.names).toEqual([
      'migration-diagnostics.json',
      'README.txt',
      'logs/app.2026-07-21.log',
      'logs/app.2026-07-21.log.1',
      'logs/app.2026-07-21.log.2'
    ])
    expect(archive.data['logs/app.2026-07-21.log']).toEqual(originalBaseLog)
    expect(archive.data['logs/app.2026-07-21.log.1']).toEqual(Buffer.from('rotated one'))

    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8'))).toEqual({
      formatVersion: 1,
      generatedAt: '2026-07-21T12:34:56.000Z',
      application: TEST_APPLICATION,
      migration: {
        source: 'renderer',
        stage: 'error',
        failureCode: 'migration_failed',
        errorSummary: 'Migration failed while copying records.',
        overallProgress: 42,
        migrators: [
          { id: 'settings', status: 'completed' },
          { id: 'messages', status: 'failed' }
        ]
      }
    })

    const readme = archive.data['README.txt'].toString('utf8')
    expect(readme).toContain('raw application logs for the local day')
    expect(readme).toContain('当天的原始应用日志，内容未经修改或脱敏')
    expect(readme).toContain('file paths, error stacks, user content, or credentials')
    expect(readme).toContain('文件路径、错误堆栈、用户内容或凭据')
    expect(readme).toContain('does not automatically upload, attach, or send this ZIP')
    expect(readme).toContain('不会自动上传、附加或发送此 ZIP')
    expect(readme.endsWith('\n')).toBe(true)
  })

  it('still saves compact diagnostics when the daily application logs are unavailable', async () => {
    const destination = join(workDirectory, 'without-logs.zip')
    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      collectApplicationLogs: async () => {
        throw new Error('log collection failed')
      }
    }).save({
      destination,
      logsDirectory,
      context: { source: 'native', stage: 'preboot', failureCode: 'database_initialize_failed' }
    })

    expect(result).toEqual({ status: 'saved', logs: 'not_included', size: 'standard' })
    const archive = await readZip(destination)
    expect(archive.names).toEqual(['migration-diagnostics.json', 'README.txt'])
    expect(JSON.parse(archive.data['migration-diagnostics.json'].toString('utf8'))).toEqual({
      formatVersion: 1,
      generatedAt: '2026-07-21T12:34:56.000Z',
      application: TEST_APPLICATION,
      migration: {
        source: 'native',
        stage: 'preboot',
        failureCode: 'database_initialize_failed'
      }
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

  it.each([
    [MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES, 'standard'],
    [MIGRATION_DIAGNOSTIC_LARGE_ZIP_BYTES + 1, 'large']
  ] as const)('classifies the final ZIP size %s as %s', async (archiveSize, expectedSize) => {
    const destination = join(workDirectory, `size-${archiveSize}.zip`)
    const result = await new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      getArchiveSize: async () => archiveSize
    }).save({
      destination,
      logsDirectory,
      context: { source: 'renderer', stage: 'error' }
    })

    expect(result).toEqual({ status: 'saved', logs: 'not_included', size: expectedSize })
  })

  it('uses the fixed public failure code for invalid targets and post-write stat failures', async () => {
    const builder = new MigrationDiagnosticBundleBuilder({
      clock: FIXED_CLOCK,
      applicationMetadata: TEST_APPLICATION,
      getArchiveSize: async () => {
        throw new Error('stat failed')
      }
    })

    await expect(
      builder.save({
        destination: join(workDirectory, 'stat-failure.zip'),
        logsDirectory,
        context: { source: 'native', stage: 'preboot' }
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })
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
