import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DiagnosticTimeRange } from '../../types'
import { collectErrorLogRecords, MAX_SCAN_RECORDS } from '../logFileSource'

function logLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify(fields)}\n`
}

function localTimestamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

function logFileName(ms: number, suffix = ''): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `app-error.${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log${suffix}`
}

describe('collectErrorLogRecords', () => {
  let logsDir: string
  const now = Date.parse('2026-08-20T12:00:00')
  const range: DiagnosticTimeRange = { fromMs: now - 60 * 60 * 1_000, toMs: now }

  beforeEach(async () => {
    logsDir = await mkdtemp(path.join(tmpdir(), 'scan-log-source-'))
  })

  afterEach(async () => {
    await rm(logsDir, { recursive: true, force: true })
  })

  it('maps new-format and pre-fix lines, counting unparsed ones', async () => {
    const inRange = now - 10 * 60 * 1_000
    const content =
      logLine({
        timestamp: localTimestamp(inRange),
        level: 'error',
        message: 'boom',
        module: 'ScanTest',
        process: 'main',
        context: { topicId: 't1' },
        code: 'EFAKE'
      }) +
      logLine({
        timestamp: localTimestamp(inRange + 1_000),
        level: 'warn',
        message: 'legacy line',
        stack: 'Error: x'
      }) +
      logLine({ timestamp: localTimestamp(inRange + 2_000), level: 'info', message: 'info never scanned' }) +
      'not json at all\n' +
      '\n' +
      logLine({ timestamp: localTimestamp(now - 2 * 60 * 60 * 1_000), level: 'error', message: 'out of range' })
    await writeFile(path.join(logsDir, logFileName(now)), content)

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.records).toHaveLength(2)
    const [first, second] = scan.records
    expect(first).toMatchObject({ level: 'error', message: 'boom', module: 'ScanTest', process: 'main' })
    // unknown top-level fields (old format) and context land in detail for anchor matching
    expect(first.detail).toContain('EFAKE')
    expect(first.detail).toContain('t1')
    expect(first.source).toEqual({ file: logFileName(now), line: 1 })
    expect(second).toMatchObject({ level: 'warn', message: 'legacy line', stack: 'Error: x' })
    expect(second.module).toBeUndefined()
    // the info line and the non-JSON line; the blank line is not an error
    expect(scan.unparsedLineCount).toBe(2)
    expect(scan.skippedFileCount).toBe(0)
    expect(scan.truncated).toBe(false)
  })

  it('keeps diagnostic fields in detail but drops the request payload', async () => {
    const inRange = now - 10 * 60 * 1_000
    await writeFile(
      path.join(logsDir, logFileName(now)),
      logLine({
        timestamp: localTimestamp(inRange),
        level: 'error',
        message: 'agent generate error',
        statusCode: 401,
        responseBody: '{"error":"invalid api key"}',
        requestBodyValues: { messages: [{ role: 'user', content: 'a 400 token budget for the model' }] },
        response: { headers: { 'x-ratelimit-limit-requests': '2000' } }
      })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    const [record] = scan.records
    expect(record.detail).toContain('401')
    expect(record.detail).toContain('invalid api key')
    // conversation text and rate-limit headers used to reach the anchors through these two keys
    expect(record.detail).not.toContain('400 token budget')
    expect(record.detail).not.toContain('x-ratelimit')
  })

  it('reads rotated .N shards but ignores app.*.log files', async () => {
    const inRange = now - 5 * 60 * 1_000
    await writeFile(
      path.join(logsDir, logFileName(now, '.1')),
      logLine({ timestamp: localTimestamp(inRange), level: 'error', message: 'from shard' })
    )
    const appLog = logFileName(now).replace('app-error.', 'app.')
    await writeFile(
      path.join(logsDir, appLog),
      logLine({ timestamp: localTimestamp(inRange), level: 'error', message: 'from general log' })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.records.map((record) => record.message)).toEqual(['from shard'])
  })

  // chmod cannot revoke read access on Windows
  it.skipIf(process.platform === 'win32')('counts unreadable files without aborting the scan', async () => {
    const inRange = now - 5 * 60 * 1_000
    const unreadable = path.join(logsDir, logFileName(now, '.1'))
    await writeFile(unreadable, logLine({ timestamp: localTimestamp(inRange), level: 'error', message: 'locked' }))
    await chmod(unreadable, 0o000)
    await writeFile(
      path.join(logsDir, logFileName(now, '.2')),
      logLine({ timestamp: localTimestamp(inRange), level: 'error', message: 'still scanned' })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.records.map((record) => record.message)).toEqual(['still scanned'])
    expect(scan.skippedFileCount).toBe(1)
  })

  it('rejects when the logs directory cannot be read instead of reporting an empty scan', async () => {
    // a swallowed outage would ship a manifest claiming a clean scan with zero findings
    await expect(collectErrorLogRecords(path.join(logsDir, 'does-not-exist'), range)).rejects.toThrow()
  })

  it('caps message and stack so one pathological line cannot blow the memory bound', async () => {
    const inRange = now - 10 * 60 * 1_000
    await writeFile(
      path.join(logsDir, logFileName(now)),
      logLine({
        timestamp: localTimestamp(inRange),
        level: 'error',
        message: `boom ${'m'.repeat(50_000)}`,
        stack: `Error: boom\n${'    at frame\n'.repeat(5_000)}`
      })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    const [record] = scan.records
    expect(record.message.length).toBeLessThanOrEqual(4 * 1024)
    expect(record.stack?.length).toBeLessThanOrEqual(4 * 1024)
    // the cap must not eat the leading text rules anchor on
    expect(record.message.startsWith('boom ')).toBe(true)
  })

  it('caps each detail field so a bulky one cannot push out a later marker', async () => {
    const inRange = now - 10 * 60 * 1_000
    await writeFile(
      path.join(logsDir, logFileName(now)),
      logLine({
        timestamp: localTimestamp(inRange),
        level: 'error',
        message: 'embedding job failed',
        errors: [{ note: 'x'.repeat(12_000) }],
        lastError: 'statusCode 429 from the embedding endpoint'
      })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    const [record] = scan.records
    expect(record.detail).toContain('statusCode 429')
    expect(record.detail?.length).toBeLessThanOrEqual(8 * 1024)
  })

  it('drops the oldest records when the cap is exceeded, not the newest', async () => {
    const inRange = now - 5 * 60 * 1_000
    const overflow = 5
    let content = ''
    for (let index = 0; index < MAX_SCAN_RECORDS + overflow; index += 1) {
      content += logLine({ timestamp: localTimestamp(inRange), level: 'error', message: `flood ${index}` })
    }
    await writeFile(path.join(logsDir, logFileName(now)), content)

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.truncated).toBe(true)
    expect(scan.records).toHaveLength(MAX_SCAN_RECORDS)
    expect(scan.records[0].message).toBe(`flood ${overflow}`)
    expect(scan.records.at(-1)?.message).toBe(`flood ${MAX_SCAN_RECORDS + overflow - 1}`)
  })

  it('orders rotated shards numerically, so the tenth is newer than the second', async () => {
    const inRange = now - 5 * 60 * 1_000
    for (const shard of ['', '.2', '.10']) {
      await writeFile(
        path.join(logsDir, logFileName(now, shard)),
        logLine({ timestamp: localTimestamp(inRange), level: 'error', message: `shard${shard || '.0'}` })
      )
    }

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.records.map((record) => record.message)).toEqual(['shard.0', 'shard.2', 'shard.10'])
  })

  it('keeps reading newer shards after an older one fills the cap', async () => {
    const inRange = now - 5 * 60 * 1_000
    let older = ''
    for (let index = 0; index < MAX_SCAN_RECORDS; index += 1) {
      older += logLine({ timestamp: localTimestamp(inRange), level: 'error', message: `old ${index}` })
    }
    await writeFile(path.join(logsDir, logFileName(now)), older)
    await writeFile(
      path.join(logsDir, logFileName(now, '.1')),
      logLine({ timestamp: localTimestamp(inRange + 1_000), level: 'error', message: 'newest' })
    )

    const scan = await collectErrorLogRecords(logsDir, range)

    expect(scan.truncated).toBe(true)
    expect(scan.records).toHaveLength(MAX_SCAN_RECORDS)
    expect(scan.records.at(-1)?.message).toBe('newest')
    expect(scan.records[0].message).toBe('old 1')
  })
})
