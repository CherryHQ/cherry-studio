import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MigrationApplicationLogCollector } from '../MigrationApplicationLogCollector'

describe('MigrationApplicationLogCollector', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(path.join(os.tmpdir(), 'cs-migration-application-log-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns the newest regular app log and excludes error logs and unrelated entries', async () => {
    const older = path.join(testDir, 'app.2026-07-20.log')
    const newest = path.join(testDir, 'app.2026-07-21.log.1')
    writeFileSync(older, 'older')
    writeFileSync(newest, 'PRIVATE_FULL_APPLICATION_LOG')
    writeFileSync(path.join(testDir, 'app-error.2026-07-21.log'), 'error-only')
    writeFileSync(path.join(testDir, 'renderer.2026-07-21.log'), 'renderer')
    mkdirSync(path.join(testDir, 'app.2026-07-22.log'))
    utimesSync(older, new Date('2026-07-20T00:00:00Z'), new Date('2026-07-20T00:00:00Z'))
    utimesSync(newest, new Date('2026-07-21T00:00:00Z'), new Date('2026-07-21T00:00:00Z'))

    const result = await new MigrationApplicationLogCollector(testDir).collect()

    expect(result).toEqual(Buffer.from('PRIVATE_FULL_APPLICATION_LOG'))
  })

  it('returns the complete bytes without redaction or truncation', async () => {
    const content = Buffer.concat([Buffer.from('TOKEN=PRIVATE_SECRET\n'), Buffer.alloc(2 * 1024 * 1024, 0x61)])
    writeFileSync(path.join(testDir, 'app.2026-07-21.log'), content)

    const result = await new MigrationApplicationLogCollector(testDir).collect()

    expect(result).toEqual(content)
  })

  it('returns null when no eligible app log is available', async () => {
    writeFileSync(path.join(testDir, 'app-error.2026-07-21.log'), 'error-only')

    await expect(new MigrationApplicationLogCollector(testDir).collect()).resolves.toBeNull()
    await expect(new MigrationApplicationLogCollector(path.join(testDir, 'missing')).collect()).resolves.toBeNull()
  })
})
