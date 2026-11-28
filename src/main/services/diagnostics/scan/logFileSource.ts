import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { openReadableFileSnapshot } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { LOG_NAME, logMayOverlapRange, parseLogTimestampString, readRawLines } from '../sourceCollector'
import type { StagedSource } from '../types'
import type { DiagnosticTimeRange } from '../types'
import { providerCredentialExposedRule } from './rules/provider'
import { SCAN_LEVELS, type ErrorLogScan, type LogRecord, type ScanLevel } from './types'

/**
 * Upper bound on records held in memory for one scan. Credential matches retain only a bounded
 * pattern prefix so large log lines cannot multiply into unbounded diagnostic state.
 */
export const MAX_SCAN_RECORDS = 20_000
const STAGED_APP_LOG_NAME = /^logs\/app\.\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/
const MAX_CREDENTIAL_MATCH_CHARS = 256
const MAX_DETAIL_CHARS = 8 * 1024
/** Comfortably above the longest stack seen in the reference corpus (2.8K), so anchors survive. */
const MAX_TEXT_CHARS = 4 * 1024

const ERROR_LOG_LEVELS: readonly ScanLevel[] = ['error', 'warn']
const KNOWN_KEYS = new Set(['timestamp', 'level', 'message', 'module', 'process', 'window', 'stack'])
// The request we sent and the full response object: never diagnostic, and serializing them puts
// conversation text and `x-ratelimit-*` headers in front of the anchors. `responseBody` stays.
const PAYLOAD_KEYS = new Set(['requestBodyValues', 'response'])

/**
 * Serializes the unknown remainder of a log line into the matchable `detail` text.
 * Shortest field first, so an oversized one can only truncate itself: anchors are short markers
 * (status codes, error codes) that a bundled `errors` array would otherwise push past the cap.
 * The result is a reordered, possibly-trimmed haystack — never parse it back.
 */
function serializeDetail(rest: Record<string, unknown>): { text: string; truncated: boolean } | undefined {
  const fields: string[] = []
  for (const [key, value] of Object.entries(rest)) {
    try {
      fields.push(`${JSON.stringify(key)}:${JSON.stringify(value) ?? 'null'}`)
    } catch {
      continue
    }
  }
  if (fields.length === 0) return undefined

  fields.sort((left, right) => left.length - right.length)
  const text = `{${fields.join(',')}}`
  return { text: text.slice(0, MAX_DETAIL_CHARS), truncated: text.length > MAX_DETAIL_CHARS }
}

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
  if (!ERROR_LOG_LEVELS.includes(value.level as ScanLevel)) return undefined

  const rest: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!KNOWN_KEYS.has(key) && !PAYLOAD_KEYS.has(key)) rest[key] = entry
  }
  const detail = serializeDetail(rest)

  return {
    timestampMs,
    level: value.level as ScanLevel,
    message: value.message.slice(0, MAX_TEXT_CHARS),
    ...(typeof value.module === 'string' && { module: value.module }),
    ...((value.process === 'main' || value.process === 'renderer') && { process: value.process }),
    ...(typeof value.window === 'string' && { window: value.window }),
    ...(typeof value.stack === 'string' && { stack: value.stack.slice(0, MAX_TEXT_CHARS) }),
    ...(detail !== undefined && { detail: detail.text }),
    ...((value.message.length > MAX_TEXT_CHARS ||
      (typeof value.stack === 'string' && value.stack.length > MAX_TEXT_CHARS) ||
      detail?.truncated) && { truncated: true as const })
  }
}

function isInRange(timestampMs: number, range: DiagnosticTimeRange): boolean {
  return timestampMs >= range.fromMs && timestampMs <= range.toMs
}

/** `app-error.2026-08-20.log.2` splits into its date-ordered base and its numeric shard index. */
function shardKey(fileName: string): readonly [string, number] {
  const match = /^(.*\.log)\.(\d+)$/.exec(fileName)
  return match ? [match[1], Number(match[2])] : [fileName, 0]
}

/**
 * Reads every `app-error.*.log` file overlapping the range into LogRecords.
 * `logsDir` is injected (rather than resolved via `@application`) so tests can
 * point it at a temporary directory.
 */
export async function collectErrorLogRecords(
  logsDir: string,
  range: DiagnosticTimeRange,
  signal?: AbortSignal
): Promise<ErrorLogScan> {
  signal?.throwIfAborted()
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

  // Deliberately not caught: an unreadable logs directory is a scan outage, and swallowing it
  // would ship a bundle whose manifest claims a clean scan with zero findings.
  const entries = await readdir(logsDir, { withFileTypes: true })
  signal?.throwIfAborted()

  const fileNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('app-error.') &&
        LOG_NAME.test(entry.name) &&
        logMayOverlapRange(entry.name, range)
    )
    .map((entry) => entry.name)
    // Rotation creates each shard with the next index, so read them in numeric order: a plain
    // sort puts `.log.10` before `.log.2` and lets older shards evict newer records from the ring.
    .sort((a, b) => {
      const [baseA, shardA] = shardKey(a)
      const [baseB, shardB] = shardKey(b)
      return baseA === baseB ? shardA - shardB : baseA < baseB ? -1 : 1
    })

  for (const fileName of fileNames) {
    signal?.throwIfAborted()
    let snapshot
    try {
      snapshot = await openReadableFileSnapshot(AbsoluteFilePathSchema.parse(path.join(logsDir, fileName)))
    } catch {
      skippedFileCount += 1
      continue
    }
    try {
      let lineNumber = 0
      for await (const line of readRawLines(snapshot, snapshot.size, signal)) {
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
        if (record.truncated) truncated = true
        keep({ ...record, source: { file: fileName, line: lineNumber } })
      }
    } catch {
      signal?.throwIfAborted()
      skippedFileCount += 1
    } finally {
      await snapshot.close().catch(() => undefined)
    }
  }

  const records = truncated ? [...ring.slice(oldest), ...ring.slice(0, oldest)] : ring
  signal?.throwIfAborted()
  return { records, unparsedLineCount, skippedFileCount, truncated }
}

export async function collectCredentialLogRecords(
  sources: readonly StagedSource[]
): Promise<{ records: LogRecord[]; scannedRecordCount: number; truncated: boolean }> {
  const records: LogRecord[] = []
  let scannedRecordCount = 0
  let truncated = false

  for (const source of sources) {
    if (source.kind !== 'logs' || !STAGED_APP_LOG_NAME.test(source.archiveName)) continue

    let lineNumber = 0
    const lines = createInterface({ input: createReadStream(source.path), crlfDelay: Infinity })
    for await (const line of lines) {
      lineNumber++
      let value: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        value = parsed as Record<string, unknown>
      } catch {
        continue
      }

      const timestampMs = typeof value.timestamp === 'string' ? parseLogTimestampString(value.timestamp) : undefined
      const level = value.level
      if (timestampMs === undefined || typeof level !== 'string' || !SCAN_LEVELS.includes(level as ScanLevel)) continue
      scannedRecordCount++
      // Scan the raw line (structured fields like "apiKey":"…" under any key)
      // and the decoded string values: JSON escaping (\", \\) hides quoted
      // credentials embedded in a message from a raw-line match.
      const decoded = Object.values(value)
        .filter((field): field is string => typeof field === 'string')
        .join('\n')
      const credentialMatch = providerCredentialExposedRule.anchors
        .map((anchor) => anchor.exec(line)?.[0] ?? (decoded === '' ? undefined : anchor.exec(decoded)?.[0]))
        .find((match): match is string => match !== undefined)
      if (!credentialMatch) continue
      if (records.length === MAX_SCAN_RECORDS) {
        truncated = true
        continue
      }

      records.push({
        timestampMs,
        level: level as ScanLevel,
        message: 'Credential-shaped value detected in application log',
        detail: credentialMatch.slice(0, MAX_CREDENTIAL_MATCH_CHARS),
        source: { file: source.archiveName, line: lineNumber }
      })
    }
  }

  return { records, scannedRecordCount, truncated }
}
