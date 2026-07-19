import fs from 'node:fs'
import path from 'node:path'

import { type MigrationDiagnosticsSession, migrationDiagnosticsSessionSchema } from './migrationDiagnosticsSchemas'

export const MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES = 1_048_576

const QUARANTINE_MAX_FILES = 2
const QUARANTINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const UTC_BASIC_TIMESTAMP_PATTERN = '\\d{8}T\\d{6}Z'

export type MigrationDiagnosticsJournalReadResult =
  | { kind: 'none' }
  | { kind: 'corrupt'; reason: 'unreadable' | 'oversized' | 'invalid' }
  | { kind: 'ok'; journal: MigrationDiagnosticsSession }

interface JournalOperationOptions {
  readonly platform?: NodeJS.Platform
}

interface QuarantineOperationOptions extends JournalOperationOptions {
  readonly now?: Date
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function fsyncDirectory(directory: string, platform = process.platform): void {
  if (platform === 'win32') {
    return
  }

  const directoryFd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(directoryFd)
  } finally {
    fs.closeSync(directoryFd)
  }
}

function unlinkIfPresent(file: string): boolean {
  try {
    fs.unlinkSync(file)
    return true
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

function readBoundedFile(file: string): Buffer | 'oversized' | 'unreadable' {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(file)
  } catch (error) {
    return isErrno(error, 'ENOENT') ? Buffer.alloc(0) : 'unreadable'
  }

  if (!stats.isFile()) {
    return 'unreadable'
  }
  if (stats.size > MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES) {
    return 'oversized'
  }

  const buffer = Buffer.allocUnsafe(MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES + 1)
  let fd: number | undefined
  let offset = 0
  let readFailed = false
  try {
    fd = fs.openSync(file, 'r')
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, offset, buffer.length - offset, null)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
  } catch {
    readFailed = true
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        readFailed = true
      }
    }
  }

  if (readFailed) {
    return 'unreadable'
  }
  if (offset > MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES) {
    return 'oversized'
  }
  return buffer.subarray(0, offset)
}

export function readMigrationDiagnosticsJournal(journalFile: string): MigrationDiagnosticsJournalReadResult {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(journalFile)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return { kind: 'none' }
    }
    return { kind: 'corrupt', reason: 'unreadable' }
  }

  if (!stats.isFile()) {
    return { kind: 'corrupt', reason: 'unreadable' }
  }

  const raw = readBoundedFile(journalFile)
  if (raw === 'oversized') {
    return { kind: 'corrupt', reason: 'oversized' }
  }
  if (raw === 'unreadable') {
    return { kind: 'corrupt', reason: 'unreadable' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    return { kind: 'corrupt', reason: 'invalid' }
  }

  const validated = migrationDiagnosticsSessionSchema.safeParse(parsed)
  return validated.success ? { kind: 'ok', journal: validated.data } : { kind: 'corrupt', reason: 'invalid' }
}

export function writeMigrationDiagnosticsJournal(
  journalFile: string,
  journal: MigrationDiagnosticsSession,
  options: JournalOperationOptions = {}
): void {
  const validated = migrationDiagnosticsSessionSchema.parse(journal)
  const serialized = JSON.stringify(validated)
  if (Buffer.byteLength(serialized, 'utf8') > MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES) {
    throw new Error('Migration diagnostics journal exceeds its fixed size limit')
  }

  const tmpFile = `${journalFile}.tmp`
  unlinkIfPresent(tmpFile)

  let fd: number | undefined
  try {
    fd = fs.openSync(tmpFile, 'wx', 0o600)
    const bytes = Buffer.from(serialized, 'utf8')
    let offset = 0
    while (offset < bytes.length) {
      offset += fs.writeSync(fd, bytes, offset, bytes.length - offset)
    }
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmpFile, journalFile)
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // Preserve the first failure while still making a best-effort close.
      }
    }
    unlinkIfPresent(tmpFile)
    throw error
  }

  fsyncDirectory(path.dirname(journalFile), options.platform)
}

function formatUtcBasicTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function quarantinePattern(journalFile: string): RegExp {
  const escapedBase = path.basename(journalFile).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escapedBase.replace(/\\\.json$/, '')}\\.corrupt\\.${UTC_BASIC_TIMESTAMP_PATTERN}\\.json$`)
}

function quarantineCandidate(journalFile: string, now: Date, offsetSeconds: number): string {
  const directory = path.dirname(journalFile)
  const base = path.basename(journalFile, '.json')
  const timestamp = formatUtcBasicTimestamp(new Date(now.getTime() + offsetSeconds * 1_000))
  return path.join(directory, `${base}.corrupt.${timestamp}.json`)
}

export function garbageCollectMigrationDiagnosticsQuarantines(
  journalFile: string,
  options: QuarantineOperationOptions = {}
): void {
  const directory = path.dirname(journalFile)
  const pattern = quarantinePattern(journalFile)
  const nowMs = (options.now ?? new Date()).getTime()
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return
    }
    throw error
  }

  const retained: Array<{ file: string; mtimeMs: number; name: string }> = []
  let removed = false
  for (const name of names) {
    if (!pattern.test(name)) {
      continue
    }
    const file = path.join(directory, name)
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(file)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        continue
      }
      throw error
    }
    if (!stats.isFile()) {
      continue
    }
    if (nowMs - stats.mtimeMs > QUARANTINE_MAX_AGE_MS) {
      removed = unlinkIfPresent(file) || removed
    } else {
      retained.push({ file, mtimeMs: stats.mtimeMs, name })
    }
  }

  retained.sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
  while (retained.length > QUARANTINE_MAX_FILES) {
    const oldest = retained.shift()
    if (oldest !== undefined) {
      removed = unlinkIfPresent(oldest.file) || removed
    }
  }

  if (removed) {
    fsyncDirectory(directory, options.platform)
  }
}

export function quarantineCorruptMigrationDiagnosticsJournal(
  journalFile: string,
  options: QuarantineOperationOptions = {}
): boolean {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(journalFile)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return false
    }
    throw error
  }

  if (!stats.isFile()) {
    return false
  }

  const directory = path.dirname(journalFile)
  const now = options.now ?? new Date()
  for (let offsetSeconds = 0; offsetSeconds < 86_400; offsetSeconds += 1) {
    const quarantinedFile = quarantineCandidate(journalFile, now, offsetSeconds)
    try {
      fs.linkSync(journalFile, quarantinedFile)
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        continue
      }
      if (isErrno(error, 'ENOENT')) {
        return false
      }
      throw error
    }

    fsyncDirectory(directory, options.platform)
    unlinkIfPresent(journalFile)
    fsyncDirectory(directory, options.platform)
    garbageCollectMigrationDiagnosticsQuarantines(journalFile, options)
    return true
  }

  throw new Error('No migration diagnostics quarantine filename is available')
}

export function cleanupMigrationDiagnosticsJournal(journalFile: string, options: JournalOperationOptions = {}): void {
  const removedJournal = unlinkIfPresent(journalFile)
  const removedTmp = unlinkIfPresent(`${journalFile}.tmp`)
  if (removedJournal || removedTmp) {
    fsyncDirectory(path.dirname(journalFile), options.platform)
  }
}
