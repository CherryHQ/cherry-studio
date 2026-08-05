import { once } from 'node:events'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { application } from '@application'
import { loggerService } from '@logger'
import {
  createAtomicWriteStream,
  lstat,
  openReadableFileSnapshot,
  type ReadableFileSnapshot,
  remove
} from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import type {
  CrashDumpInventory,
  DiagnosticSourceKind,
  DiagnosticTimeRange,
  DiagnosticWarning,
  SourceCandidate,
  SourceCollection,
  SourceIdentity,
  SourceStats,
  StagedSource
} from './types'

const logger = loggerService.withContext('DiagnosticSourceCollector')
const LOG_NAME = /^app(?:-error)?\.(\d{4}-\d{2}-\d{2})\.log(?:\.\d+)?$/
const MAX_JSON_LINE_BYTES = 16 * 1024 * 1024

interface RawLine {
  readonly data?: Buffer
  readonly tooLarge: boolean
}

interface ScanResult {
  readonly eligibleBytes: number
  readonly latestAt: number
  readonly malformedLineCount: number
}

interface SourceSelection {
  readonly includeLogs: boolean
  readonly includeTraces: boolean
}

type ClassifiedLine = 'malformed' | { readonly data: Buffer; readonly timestamp: number } | undefined

export class SourceChangedError extends Error {
  constructor() {
    super('Diagnostic source changed while it was being exported')
  }
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
}

function logReadFailure(message: string, error: unknown): void {
  logger.warn(message, { code: errorCode(error) })
}

function sourceIdentity(snapshot: ReadableFileSnapshot): SourceIdentity {
  return {
    dev: snapshot.dev,
    ino: snapshot.ino,
    modifiedAt: snapshot.modifiedAt,
    size: snapshot.size
  }
}

function hasSameIdentity(snapshot: ReadableFileSnapshot, identity: SourceIdentity): boolean {
  return (
    snapshot.dev === identity.dev &&
    snapshot.ino === identity.ino &&
    snapshot.modifiedAt === identity.modifiedAt &&
    snapshot.size === identity.size
  )
}

async function* readRawLines(snapshot: ReadableFileSnapshot, snapshotBytes = snapshot.size): AsyncGenerator<RawLine> {
  const parts: Buffer[] = []
  let lineBytes = 0
  let bytesRead = 0
  let tooLarge = false

  for await (const chunk of snapshot.createReadStream(snapshotBytes)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytesRead += buffer.length
    if (bytesRead > snapshotBytes) throw new SourceChangedError()

    let offset = 0
    while (offset < buffer.length) {
      const newline = buffer.indexOf(0x0a, offset)
      const end = newline === -1 ? buffer.length : newline + 1
      const part = buffer.subarray(offset, end)
      if (!tooLarge) {
        if (lineBytes + part.length > MAX_JSON_LINE_BYTES) {
          tooLarge = true
          parts.length = 0
          lineBytes = 0
        } else {
          parts.push(part)
          lineBytes += part.length
        }
      }

      if (newline !== -1) {
        yield tooLarge ? { tooLarge: true } : { data: Buffer.concat(parts, lineBytes), tooLarge: false }
        parts.length = 0
        lineBytes = 0
        tooLarge = false
      }
      offset = end
    }
  }

  if (bytesRead !== snapshotBytes) throw new SourceChangedError()
  if (tooLarge || lineBytes > 0) {
    yield tooLarge ? { tooLarge: true } : { data: Buffer.concat(parts, lineBytes), tooLarge: false }
  }
}

function parseLineTimestamp(line: Buffer, kind: DiagnosticSourceKind): number | 'empty' | undefined {
  const text = line.toString('utf8').trim()
  if (!text) return 'empty'

  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (kind === 'traces') {
      return typeof value.startTime === 'number' && Number.isFinite(value.startTime) ? value.startTime : undefined
    }
    if (typeof value.timestamp !== 'string') return undefined
    const timestamp = Date.parse(value.timestamp.includes('T') ? value.timestamp : value.timestamp.replace(' ', 'T'))
    return Number.isFinite(timestamp) ? timestamp : undefined
  } catch {
    return undefined
  }
}

function isInRange(timestamp: number, range: DiagnosticTimeRange): boolean {
  return timestamp >= range.fromMs && timestamp <= range.toMs
}

function classifyLine(line: RawLine, kind: DiagnosticSourceKind, range: DiagnosticTimeRange): ClassifiedLine {
  if (line.tooLarge || !line.data) return 'malformed'
  const timestamp = parseLineTimestamp(line.data, kind)
  if (timestamp === 'empty') return undefined
  if (timestamp === undefined) return 'malformed'
  if (!isInRange(timestamp, range)) return undefined
  return { data: line.data, timestamp }
}

function logMayOverlapRange(fileName: string, range: DiagnosticTimeRange): boolean {
  const match = LOG_NAME.exec(fileName)
  if (!match) return false

  const [year, month, day] = match[1].split('-').map(Number)
  const dayStart = new Date(year, month - 1, day)
  if (dayStart.getFullYear() !== year || dayStart.getMonth() !== month - 1 || dayStart.getDate() !== day) {
    return false
  }
  const nextDay = new Date(year, month - 1, day + 1)
  return dayStart.getTime() <= range.toMs && nextDay.getTime() > range.fromMs
}

async function scanSnapshot(
  snapshot: ReadableFileSnapshot,
  kind: DiagnosticSourceKind,
  range: DiagnosticTimeRange
): Promise<ScanResult> {
  let eligibleBytes = 0
  let latestAt = 0
  let malformedLineCount = 0

  for await (const line of readRawLines(snapshot)) {
    const classified = classifyLine(line, kind, range)
    if (classified === 'malformed') {
      malformedLineCount += 1
      continue
    }
    if (!classified) continue
    eligibleBytes += classified.data.length
    latestAt = Math.max(latestAt, classified.timestamp)
  }

  return { eligibleBytes, latestAt, malformedLineCount }
}

function portableSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex')
}

async function scanCandidate(
  sourcePath: AbsoluteFilePath,
  archiveName: string,
  kind: DiagnosticSourceKind,
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): Promise<SourceCandidate | undefined> {
  let snapshot: ReadableFileSnapshot | undefined
  try {
    snapshot = await openReadableFileSnapshot(sourcePath)
    const scan = await scanSnapshot(snapshot, kind, range)
    if (scan.malformedLineCount > 0) warnings.add('malformed_lines')
    if (scan.eligibleBytes === 0) return undefined
    return {
      archiveName,
      eligibleBytes: scan.eligibleBytes,
      identity: sourceIdentity(snapshot),
      kind,
      latestAt: scan.latestAt,
      malformedLineCount: scan.malformedLineCount,
      sourcePath
    }
  } catch (error) {
    warnings.add(error instanceof SourceChangedError ? 'source_changed' : 'source_unreadable')
    logReadFailure('Failed to inspect a diagnostic source', error)
    return undefined
  } finally {
    await snapshot?.close().catch(() => undefined)
  }
}

async function discoverLogs(range: DiagnosticTimeRange, warnings: Set<DiagnosticWarning>): Promise<SourceCandidate[]> {
  let entries
  try {
    entries = await readdir(application.getPath('app.logs'), { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      warnings.add('source_unreadable')
      logReadFailure('Failed to list application logs for diagnostics', error)
    }
    return []
  }

  const candidates: SourceCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !logMayOverlapRange(entry.name, range)) continue
    const sourcePath = AbsoluteFilePathSchema.parse(application.getPath('app.logs', entry.name))
    const candidate = await scanCandidate(sourcePath, `logs/${entry.name}`, 'logs', range, warnings)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

async function discoverTraces(
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): Promise<SourceCandidate[]> {
  const root = application.getPath('feature.trace')
  let topics
  try {
    topics = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      warnings.add('source_unreadable')
      logReadFailure('Failed to list persisted traces for diagnostics', error)
    }
    return []
  }

  const candidates: SourceCandidate[] = []
  for (const topic of topics) {
    if (!topic.isDirectory()) continue
    const topicPath = path.join(root, topic.name)
    let traces
    try {
      traces = await readdir(topicPath, { withFileTypes: true })
    } catch (error) {
      warnings.add('source_unreadable')
      logReadFailure('Failed to list a persisted trace directory for diagnostics', error)
      continue
    }

    for (const trace of traces) {
      if (!trace.isFile()) continue
      const sourcePath = AbsoluteFilePathSchema.parse(path.join(topicPath, trace.name))
      try {
        const fileStat = await lstat(sourcePath)
        if (!fileStat.isFile || fileStat.modifiedAt < range.fromMs) continue
      } catch (error) {
        warnings.add('source_unreadable')
        logReadFailure('Failed to inspect a persisted trace for diagnostics', error)
        continue
      }
      const archiveName = `traces/${portableSegment(topic.name)}/${portableSegment(trace.name)}.jsonl`
      const candidate = await scanCandidate(sourcePath, archiveName, 'traces', range, warnings)
      if (candidate) candidates.push(candidate)
    }
  }
  return candidates
}

export async function collectDiagnosticSources(
  range: DiagnosticTimeRange,
  selection: SourceSelection
): Promise<SourceCollection> {
  const warnings = new Set<DiagnosticWarning>()
  const logs = selection.includeLogs ? await discoverLogs(range, warnings) : []
  const traces = selection.includeTraces ? await discoverTraces(range, warnings) : []
  return { logs, traces, warnings }
}

function newestFirst(a: SourceCandidate, b: SourceCandidate): number {
  return b.latestAt - a.latestAt || a.archiveName.localeCompare(b.archiveName)
}

function canStageSnapshot(candidate: SourceCandidate, snapshot: ReadableFileSnapshot): boolean {
  if (hasSameIdentity(snapshot, candidate.identity)) return true
  return (
    candidate.kind === 'logs' &&
    snapshot.dev === candidate.identity.dev &&
    snapshot.ino === candidate.identity.ino &&
    snapshot.size > candidate.identity.size
  )
}

export function selectSourceCandidates(
  candidates: readonly SourceCandidate[],
  limitBytes: number
): { selected: SourceCandidate[]; omitted: SourceCandidate[] } {
  const byKind = {
    logs: candidates.filter((candidate) => candidate.kind === 'logs').sort(newestFirst),
    traces: candidates.filter((candidate) => candidate.kind === 'traces').sort(newestFirst)
  }
  const selected = new Set<SourceCandidate>()
  let remainingBytes = limitBytes
  const newestPerKind = [byKind.logs[0], byKind.traces[0]].filter(
    (candidate): candidate is SourceCandidate => candidate !== undefined
  )

  if (newestPerKind.reduce((total, candidate) => total + candidate.eligibleBytes, 0) <= remainingBytes) {
    for (const candidate of newestPerKind) {
      selected.add(candidate)
      remainingBytes -= candidate.eligibleBytes
    }
  } else {
    for (const candidate of newestPerKind.sort(newestFirst)) {
      if (candidate.eligibleBytes > remainingBytes) continue
      selected.add(candidate)
      remainingBytes -= candidate.eligibleBytes
    }
  }

  for (const candidate of [...candidates].sort(newestFirst)) {
    if (selected.has(candidate) || candidate.eligibleBytes > remainingBytes) continue
    selected.add(candidate)
    remainingBytes -= candidate.eligibleBytes
  }

  return {
    selected: candidates.filter((candidate) => selected.has(candidate)).sort(newestFirst),
    omitted: candidates.filter((candidate) => !selected.has(candidate)).sort(newestFirst)
  }
}

export function sourceStats(candidates: readonly SourceCandidate[]): SourceStats {
  return candidates.reduce<SourceStats>(
    (stats, candidate) => ({
      bytes: stats.bytes + candidate.eligibleBytes,
      fileCount: stats.fileCount + 1,
      malformedLineCount: stats.malformedLineCount + candidate.malformedLineCount
    }),
    { bytes: 0, fileCount: 0, malformedLineCount: 0 }
  )
}

export async function stageSourceCandidate(
  candidate: SourceCandidate,
  range: DiagnosticTimeRange,
  destination: AbsoluteFilePath
): Promise<StagedSource> {
  const snapshot = await openReadableFileSnapshot(candidate.sourcePath)
  const writer = createAtomicWriteStream(destination)
  const completion = finished(writer)
  // Observe writer failures immediately while the read loop may still be awaiting another event.
  void completion.catch(() => undefined)
  let bytes = 0
  let malformedLineCount = 0

  try {
    if (!canStageSnapshot(candidate, snapshot)) throw new SourceChangedError()

    for await (const line of readRawLines(snapshot, candidate.identity.size)) {
      const classified = classifyLine(line, candidate.kind, range)
      if (classified === 'malformed') {
        malformedLineCount += 1
        continue
      }
      if (!classified) continue
      bytes += classified.data.length
      if (!writer.write(classified.data)) await once(writer, 'drain')
    }
    if (bytes !== candidate.eligibleBytes || malformedLineCount !== candidate.malformedLineCount) {
      throw new SourceChangedError()
    }
    writer.end()
    await completion
    return {
      archiveName: candidate.archiveName,
      bytes,
      kind: candidate.kind,
      malformedLineCount,
      path: destination
    }
  } catch (error) {
    if (!writer.destroyed) await writer.abort().catch(() => undefined)
    await remove(destination).catch(() => undefined)
    throw error
  } finally {
    await snapshot.close().catch(() => undefined)
  }
}

export async function collectCrashDumpInventory(
  range: DiagnosticTimeRange,
  warnings: Set<DiagnosticWarning>
): Promise<CrashDumpInventory> {
  const files: Array<{ createdAt: string; size: number }> = []
  const root = AbsoluteFilePathSchema.parse(application.getPath('app.crash_dumps'))
  const directories = [{ depth: 0, path: root }]

  while (directories.length > 0) {
    const directory = directories.pop()!
    try {
      const directoryStat = await lstat(directory.path)
      if (!directoryStat.isDirectory) {
        warnings.add('source_unreadable')
        continue
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        warnings.add('source_unreadable')
        logReadFailure('Failed to inspect a crash dump directory for diagnostics', error)
      }
      continue
    }

    let entries
    try {
      entries = await readdir(directory.path, { withFileTypes: true })
    } catch (error) {
      warnings.add('source_unreadable')
      logReadFailure('Failed to list a crash dump directory for diagnostics', error)
      continue
    }

    for (const entry of entries) {
      const entryPath = AbsoluteFilePathSchema.parse(path.join(directory.path, entry.name))
      if (entry.isDirectory() && directory.depth < 3) {
        directories.push({ depth: directory.depth + 1, path: entryPath })
        continue
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.dmp') continue
      try {
        const fileStat = await lstat(entryPath)
        if (!fileStat.isFile || fileStat.modifiedAt < range.fromMs || fileStat.modifiedAt > range.toMs) continue
        files.push({ createdAt: new Date(fileStat.modifiedAt).toISOString(), size: fileStat.size })
      } catch (error) {
        warnings.add('source_unreadable')
        logReadFailure('Failed to inspect a crash dump inventory entry', error)
      }
    }
  }

  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    files,
    totalBytes: files.reduce((total, file) => total + file.size, 0)
  }
}
