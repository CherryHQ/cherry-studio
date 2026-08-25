import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { openReadableFileSnapshot } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { LOG_NAME, logMayOverlapRange, parseLogTimestampString, readRawLines } from '../sourceCollector'
import type { DiagnosticTimeRange } from '../types'
import type { ErrorLogScan, LogRecord, ScanLevel } from './types'

/** Upper bound on records held in memory for one scan (~20MB with truncated details). */
export const MAX_SCAN_RECORDS = 20_000
const MAX_DETAIL_CHARS = 8 * 1024

const SCAN_LEVELS: readonly ScanLevel[] = ['error', 'warn']
const KNOWN_KEYS = new Set(['timestamp', 'level', 'message', 'module', 'process', 'window', 'stack'])
// The request we sent and the full response object: never diagnostic, and serializing them puts
// conversation text and `x-ratelimit-*` headers in front of the anchors. `responseBody` stays.
const PAYLOAD_KEYS = new Set(['requestBodyValues', 'response'])

/**
 * Parses one raw `app-error.*.log` line into a LogRecord.
 * Returns undefined for blank, malformed, or non-warn/error lines.
 * Exported so rule fixtures run through the exact production parse path.
 */
export function parseErrorLogLine(text: string): Omit<LogRecord, 'source'> | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  let value: Record<string, unknown>
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    value = parsed as Record<string, unknown>
  } catch {
    return undefined
  }

  if (typeof value.timestamp !== 'string' || typeof value.message !== 'string') return undefined
  const timestampMs = parseLogTimestampString(value.timestamp)
  if (timestampMs === undefined) return undefined
  if (!SCAN_LEVELS.includes(value.level as ScanLevel)) return undefined

  const rest: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!KNOWN_KEYS.has(key) && !PAYLOAD_KEYS.has(key)) rest[key] = entry
  }
  let detail: string | undefined
  if (Object.keys(rest).length > 0) {
    try {
      detail = JSON.stringify(rest).slice(0, MAX_DETAIL_CHARS)
    } catch {
      detail = undefined
    }
  }

  return {
    timestampMs,
    level: value.level as ScanLevel,
    message: value.message,
    ...(typeof value.module === 'string' && { module: value.module }),
    ...((value.process === 'main' || value.process === 'renderer') && { process: value.process }),
    ...(typeof value.window === 'string' && { window: value.window }),
    ...(typeof value.stack === 'string' && { stack: value.stack }),
    ...(detail !== undefined && { detail })
  }
}

function isInRange(timestampMs: number, range: DiagnosticTimeRange): boolean {
  return timestampMs >= range.fromMs && timestampMs <= range.toMs
}

/**
 * Reads every `app-error.*.log` file overlapping the range into LogRecords.
 * `logsDir` is injected (rather than resolved via `@application`) so tests can
 * point it at a temporary directory.
 */
export async function collectErrorLogRecords(logsDir: string, range: DiagnosticTimeRange): Promise<ErrorLogScan> {
  // Ring buffer over the newest records: overflow must drop the oldest, because the errors
  // worth diagnosing are the ones the user just hit, not the ones that opened the window.
  const ring: LogRecord[] = []
  let oldest = 0
  let unparsedLineCount = 0
  let skippedFileCount = 0
  let truncated = false

  const keep = (record: LogRecord): void => {
    if (ring.length < MAX_SCAN_RECORDS) {
      ring.push(record)
      return
    }
    ring[oldest] = record
    oldest = (oldest + 1) % MAX_SCAN_RECORDS
    truncated = true
  }

  let entries
  try {
    entries = await readdir(logsDir, { withFileTypes: true })
  } catch {
    return { records: [], unparsedLineCount, skippedFileCount: 1, truncated }
  }

  const fileNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('app-error.') &&
        LOG_NAME.test(entry.name) &&
        logMayOverlapRange(entry.name, range)
    )
    .map((entry) => entry.name)
    .sort()

  for (const fileName of fileNames) {
    let snapshot
    try {
      snapshot = await openReadableFileSnapshot(AbsoluteFilePathSchema.parse(path.join(logsDir, fileName)))
    } catch {
      skippedFileCount += 1
      continue
    }
    try {
      let lineNumber = 0
      for await (const line of readRawLines(snapshot)) {
        lineNumber += 1
        if (line.tooLarge || !line.data) {
          unparsedLineCount += 1
          continue
        }
        const text = line.data.toString('utf8')
        if (!text.trim()) continue
        const record = parseErrorLogLine(text)
        if (!record) {
          unparsedLineCount += 1
          continue
        }
        if (!isInRange(record.timestampMs, range)) continue
        keep({ ...record, source: { file: fileName, line: lineNumber } })
      }
    } catch {
      skippedFileCount += 1
    } finally {
      await snapshot.close().catch(() => undefined)
    }
  }

  const records = truncated ? [...ring.slice(oldest), ...ring.slice(0, oldest)] : ring
  return { records, unparsedLineCount, skippedFileCount, truncated }
}
