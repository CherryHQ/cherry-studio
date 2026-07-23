import { type FileHandle, lstat, open, readdir } from 'node:fs/promises'
import { release } from 'node:os'
import path from 'node:path'
import { type Readable, Transform } from 'node:stream'

import { application } from '@application'
import { loggerService } from '@logger'
import { createAtomicWriteStream, isSameFile } from '@main/utils/file'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import type { FilePath } from '@shared/types/file'
import { ZipArchive } from 'archiver'
import { app } from 'electron'

import { isValidLocalDate } from './utils/localDate'

const logger = loggerService.withContext('migrationDiagnosticBundle')
const LOG_NAME = /^app\.(\d{4}-\d{2}-\d{2})\.log(?:\.\d+)?$/

interface SaveMigrationDiagnosticBundleInput {
  destination: string
  stage: MigrationStage
  logDate: string
}

interface MigrationDiagnosticBundleDependencies {
  readonly openLogFile?: (filePath: FilePath) => Promise<FileHandle>
  readonly createLogReadStream?: (handle: FileHandle, snapshotBytes: number) => Readable
}

interface LogCandidate {
  readonly fileName: string
  readonly filePath: FilePath
}

interface LogSnapshot {
  readonly fileName: string
  readonly handle: FileHandle
  readonly snapshotBytes: number
}

class LogReadFailure extends Error {
  constructor(cause: unknown) {
    super('Failed to read a fixed log snapshot', { cause })
  }
}

function validateDestination(value: string): FilePath | undefined {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return undefined
  const terminal = value.split(process.platform === 'win32' ? /[\\/]/ : '/').at(-1)
  if (!terminal || terminal === '.' || terminal === '..') return undefined
  const normalized = path.normalize(value)
  if (normalized === path.parse(normalized).root) return undefined
  return value as FilePath
}

async function selectLogFiles(logDate: string): Promise<LogCandidate[]> {
  const entries = await readdir(application.getPath('app.logs'), { withFileTypes: true })
  const eligible = entries.flatMap((entry) => {
    if (!entry.isFile()) return []
    const match = LOG_NAME.exec(entry.name)
    return match && isValidLocalDate(match[1]) ? [{ fileName: entry.name, date: match[1] }] : []
  })
  const selectedDate = eligible.some(({ date }) => date === logDate)
    ? logDate
    : eligible
        .map(({ date }) => date)
        .sort()
        .at(-1)
  if (!selectedDate) return []

  return eligible
    .filter(({ date }) => date === selectedDate)
    .sort(({ fileName: a }, { fileName: b }) => (a < b ? -1 : a > b ? 1 : 0))
    .map(({ fileName }) => ({
      fileName,
      filePath: application.getPath('app.logs', fileName) as FilePath
    }))
}

async function createSnapshots(
  candidates: LogCandidate[],
  handles: FileHandle[],
  openLogFile: (filePath: FilePath) => Promise<FileHandle>
): Promise<LogSnapshot[]> {
  const snapshots: LogSnapshot[] = []
  for (const { fileName, filePath } of candidates) {
    const pathStat = await lstat(filePath)
    if (!pathStat.isFile()) throw new Error('Selected log path is not a regular file')
    const handle = await openLogFile(filePath)
    handles.push(handle)
    const handleStat = await handle.stat()
    if (!handleStat.isFile() || pathStat.dev !== handleStat.dev || pathStat.ino !== handleStat.ino) {
      throw new Error('Selected log changed before it could be opened')
    }
    snapshots.push({ fileName, handle, snapshotBytes: handleStat.size })
  }
  return snapshots
}

function exactLengthStream(expectedBytes: number, onFailure: (error: Error) => void): Transform {
  let bytesRead = 0
  const fail = (message: string, callback: (error?: Error | null) => void) => {
    const error = new LogReadFailure(new Error(message))
    onFailure(error)
    callback(error)
  }
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesRead += chunk.length
      if (bytesRead > expectedBytes) {
        fail('Log stream exceeded its fixed snapshot', callback)
      } else {
        callback(null, chunk)
      }
    },
    flush(callback) {
      if (bytesRead !== expectedBytes) {
        fail('Log stream ended before its fixed snapshot', callback)
      } else {
        callback()
      }
    }
  })
}

async function writeZip(
  destination: FilePath,
  metadata: string,
  snapshots: LogSnapshot[],
  createLogReadStream: (handle: FileHandle, snapshotBytes: number) => Readable
): Promise<void> {
  const output = createAtomicWriteStream(destination)
  const archive = new ZipArchive({ zlib: { level: 1 } })
  const activeStreams = new Set<Readable>()
  let rejectCompletion: (error: unknown) => void = () => undefined
  const completion = new Promise<void>((resolve, reject) => {
    rejectCompletion = reject
    output.once('finish', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.once('warning', reject)
  })
  const failLogRead = (error: Error): LogReadFailure => {
    const failure = error instanceof LogReadFailure ? error : new LogReadFailure(error)
    rejectCompletion(failure)
    return failure
  }

  try {
    archive.pipe(output)
    archive.append(metadata, { name: 'migration-diagnostics.json' })
    for (const snapshot of snapshots) {
      if (snapshot.snapshotBytes === 0) {
        archive.append(Buffer.alloc(0), { name: `logs/${snapshot.fileName}` })
        continue
      }
      let source: Readable
      try {
        source = createLogReadStream(snapshot.handle, snapshot.snapshotBytes)
      } catch (error) {
        throw new LogReadFailure(error)
      }
      const counted = exactLengthStream(snapshot.snapshotBytes, failLogRead)
      activeStreams.add(source)
      activeStreams.add(counted)
      source.once('error', (error) => {
        counted.destroy(failLogRead(error))
      })
      counted.once('error', failLogRead)
      source.pipe(counted)
      archive.append(counted, { name: `logs/${snapshot.fileName}` })
    }
    await Promise.all([archive.finalize(), completion])
  } catch (error) {
    for (const stream of activeStreams) stream.destroy()
    archive.abort()
    if (!output.closed) await output.abort().catch(() => undefined)
    throw error
  }
}

export async function saveMigrationDiagnosticBundle(
  input: SaveMigrationDiagnosticBundleInput,
  dependencies: MigrationDiagnosticBundleDependencies = {}
): Promise<'included' | 'not_included' | false> {
  const destination = validateDestination(input.destination)
  if (!destination) return false

  const openLogFile = dependencies.openLogFile ?? ((filePath) => open(filePath, 'r'))
  const createLogReadStream =
    dependencies.createLogReadStream ??
    ((handle, snapshotBytes) => handle.createReadStream({ start: 0, end: snapshotBytes - 1, autoClose: false }))
  const metadata = JSON.stringify({
    application: { version: app.getVersion() },
    system: { platform: process.platform, arch: process.arch, release: release() },
    migration: { stage: input.stage }
  })
  const handles: FileHandle[] = []

  try {
    let candidates: LogCandidate[] = []
    let snapshots: LogSnapshot[] = []
    try {
      candidates = await selectLogFiles(input.logDate)
      snapshots = await createSnapshots(candidates, handles, openLogFile)
    } catch (error) {
      logger.warn('Application logs could not be snapshotted; saving metadata only', error as Error)
    }
    for (const candidate of candidates) {
      if (await isSameFile(destination, candidate.filePath)) return false
    }
    if (snapshots.length === 0) {
      await writeZip(destination, metadata, [], createLogReadStream)
      return 'not_included'
    }
    try {
      await writeZip(destination, metadata, snapshots, createLogReadStream)
      return 'included'
    } catch (error) {
      if (!(error instanceof LogReadFailure)) throw error
      await writeZip(destination, metadata, [], createLogReadStream)
      return 'not_included'
    }
  } catch (error) {
    logger.error('Failed to save migration diagnostic bundle', error as Error)
    return false
  } finally {
    await Promise.allSettled(handles.map((handle) => handle.close()))
  }
}
