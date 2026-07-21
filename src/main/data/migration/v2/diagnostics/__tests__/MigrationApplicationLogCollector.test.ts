import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MigrationApplicationLogCollector } from '../MigrationApplicationLogCollector'

describe('MigrationApplicationLogCollector', () => {
  let logsDirectory: string

  beforeEach(async () => {
    logsDirectory = await mkdtemp(join(tmpdir(), 'migration-application-logs-'))
  })

  afterEach(async () => {
    await rm(logsDirectory, { recursive: true, force: true })
  })

  it('collects only regular application logs for the local save day in numeric rotation order', async () => {
    await Promise.all([
      writeFile(join(logsDirectory, 'app.2026-07-21.log'), Buffer.from([0x00, 0xff, 0x62, 0x61, 0x73, 0x65])),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.1'), 'one'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.2'), 'two'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.10'), 'ten'),
      writeFile(join(logsDirectory, 'app-error.2026-07-21.log'), 'duplicate errors'),
      writeFile(join(logsDirectory, 'app.2026-07-20.log'), 'previous day'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.5.tmp'), 'fake suffix'),
      mkdir(join(logsDirectory, 'app.2026-07-21.log.3'))
    ])
    await symlink(join(logsDirectory, 'app.2026-07-21.log.1'), join(logsDirectory, 'app.2026-07-21.log.4'))

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12)
    }).collect()

    expect(result).toEqual({
      status: 'included',
      entries: [
        { fileName: 'app.2026-07-21.log', data: Buffer.from([0x00, 0xff, 0x62, 0x61, 0x73, 0x65]) },
        { fileName: 'app.2026-07-21.log.1', data: Buffer.from('one') },
        { fileName: 'app.2026-07-21.log.2', data: Buffer.from('two') },
        { fileName: 'app.2026-07-21.log.10', data: Buffer.from('ten') }
      ]
    })
  })

  it('returns not_included when no eligible application log exists', async () => {
    await writeFile(join(logsDirectory, 'app-error.2026-07-21.log'), 'errors only')

    await expect(
      new MigrationApplicationLogCollector({
        logsDirectory,
        clock: () => new Date(2026, 6, 21, 12)
      }).collect()
    ).resolves.toEqual({ status: 'not_included', entries: [] })
  })

  it('discards the entire collection when any selected log cannot be read', async () => {
    await Promise.all([
      writeFile(join(logsDirectory, 'app.2026-07-21.log'), 'base'),
      writeFile(join(logsDirectory, 'app.2026-07-21.log.1'), 'one')
    ])
    const injectedReadFile = vi.fn(async (filePath: string) => {
      if (basename(filePath).endsWith('.1')) throw new Error('unreadable')
      return readFile(filePath)
    })

    const result = await new MigrationApplicationLogCollector({
      logsDirectory,
      clock: () => new Date(2026, 6, 21, 12),
      readFile: injectedReadFile
    }).collect()

    expect(result).toEqual({ status: 'not_included', entries: [] })
  })

  it('returns not_included when the logs directory cannot be scanned', async () => {
    const missingDirectory = join(logsDirectory, 'missing')

    await expect(
      new MigrationApplicationLogCollector({
        logsDirectory: missingDirectory,
        clock: () => new Date(2026, 6, 21, 12)
      }).collect()
    ).resolves.toEqual({ status: 'not_included', entries: [] })
  })
})
