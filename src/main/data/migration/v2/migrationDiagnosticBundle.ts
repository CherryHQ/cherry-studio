import { type FileHandle, lstat, open, readdir, stat } from 'node:fs/promises'
import { release } from 'node:os'
import path from 'node:path'
import { type Readable, Transform } from 'node:stream'

import { application } from '@application'
import { loggerService } from '@logger'
import { createAtomicWriteStream } from '@main/utils/file'
import type { MigrationStage } from '@shared/data/migration/v2/types'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
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
  readonly openLogFile?: (filePath: AbsoluteFilePath) => Promise<FileHandle>
  readonly createLogReadStream?: (handle: FileHandle, snapshotBytes: number) => Readable
  readonly readLogDirectory?: (logsPath: string) => Promise<readonly LogDirectoryEntry[]>
}

interface LogDirectoryEntry {
  readonly name: string
  isFile(): boolean
}

interface LogCandidate {
  readonly fileName: string
  readonly filePath: AbsoluteFilePath
}

interface LogSnapshot {
  readonly fileName: string
  readonly handle: FileHandle
  readonly snapshotBytes: number
}

interface PresentFileIdentity {
  readonly dev: number
  readonly ino: number
}

type FileIdentity =
  | ({ readonly status: 'present' } & PresentFileIdentity)
  | { readonly status: 'missing' }
  | { readonly status: 'unverifiable' }

class LogReadFailure extends Error {
  constructor(cause: unknown) {
    super('Failed to read a fixed log snapshot', { cause })
  }
}

function validateDestination(value: string): AbsoluteFilePath | undefined {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return undefined
  const terminal = value.split(process.platform === 'win32' ? /[\\/]/ : '/').at(-1)
  if (!terminal || terminal === '.' || terminal === '..') return undefined
  const normalized = path.normalize(value)
  if (normalized === path.parse(normalized).root) return undefined
  return AbsoluteFilePathSchema.parse(value)
}

async function selectLogFiles(
  logDate: string,
  readLogDirectory: (logsPath: string) => Promise<readonly LogDirectoryEntry[]>
): Promise<LogCandidate[]> {
  const entries = await readLogDirectory(application.getPath('app.logs'))
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
      filePath: AbsoluteFilePathSchema.parse(application.getPath('app.logs', fileName))
    }))
}

async function probeFileIdentity(filePath: AbsoluteFilePath): Promise<FileIdentity> {
  try {
    const fileStat = await stat(filePath)
    return { status: 'present', dev: fileStat.dev, ino: fileStat.ino }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { status: 'missing' } : { status: 'unverifiable' }
  }
}

async function createSnapshots(
  candidates: LogCandidate[],
  handles: FileHandle[],
  sourceIdentities: PresentFileIdentity[],
  openLogFile: (filePath: AbsoluteFilePath) => Promise<FileHandle>
): Promise<LogSnapshot[]> {
  const snapshots: LogSnapshot[] = []
  for (const { fileName, filePath } of candidates) {
    const pathStat = await lstat(filePath)
    if (!pathStat.isFile()) throw new Error('Selected log path is not a regular file')
    const handle = await openLogFile(filePath)
    handles.push(handle)
    const handleStat = await handle.stat()
    sourceIdentities.push({ dev: handleStat.dev, ino: handleStat.ino })
    if (!handleStat.isFile() || pathStat.dev !== handleStat.dev || pathStat.ino !== handleStat.ino) {
      throw new Error('Selected log changed before it could be opened')
    }
    snapshots.push({ fileName, handle, snapshotBytes: handleStat.size })
  }
  return snapshots
}

function hasSameIdentity(a: PresentFileIdentity, b: PresentFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

async function canWriteDestination(
  destination: AbsoluteFilePath,
  initialIdentity: FileIdentity,
  sourceIdentities: readonly PresentFileIdentity[]
): Promise<boolean> {
  const currentIdentity = await probeFileIdentity(destination)
  if (currentIdentity.status === 'unverifiable' || currentIdentity.status !== initialIdentity.status) return false
  if (currentIdentity.status === 'missing') return true
  if (initialIdentity.status !== 'present') return false
  if (!hasSameIdentity(currentIdentity, initialIdentity)) return false
  return !sourceIdentities.some((sourceIdentity) => hasSameIdentity(currentIdentity, sourceIdentity))
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
  destination: AbsoluteFilePath,
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
  const readLogDirectory = dependencies.readLogDirectory ?? ((logsPath) => readdir(logsPath, { withFileTypes: true }))
  const metadata = JSON.stringify({
    application: { version: app.getVersion() },
    system: { platform: process.platform, arch: process.arch, release: release() },
    migration: { stage: input.stage }
  })
  const handles: FileHandle[] = []
  const sourceIdentities: PresentFileIdentity[] = []

  try {
    const destinationIdentity = await probeFileIdentity(destination)
    if (destinationIdentity.status === 'unverifiable') return false

    let candidates: LogCandidate[]
    try {
      candidates = await selectLogFiles(input.logDate, readLogDirectory)
    } catch (error) {
      if (destinationIdentity.status === 'present') {
        logger.warn(
          'Application logs could not be discovered; refusing to overwrite an existing destination',
          error as Error
        )
        return false
      }
      logger.warn('Application logs could not be discovered; saving metadata only', error as Error)
      if (!(await canWriteDestination(destination, destinationIdentity, sourceIdentities))) return false
      await writeZip(destination, metadata, [], createLogReadStream)
      return 'not_included'
    }

    const normalizedDestination = path.normalize(destination)
    if (candidates.some((candidate) => path.normalize(candidate.filePath) === normalizedDestination)) return false

    let snapshots: LogSnapshot[] = []
    try {
      snapshots = await createSnapshots(candidates, handles, sourceIdentities, openLogFile)
    } catch (error) {
      logger.warn('Application logs could not be snapshotted; saving metadata only', error as Error)
    }
    if (snapshots.length === 0) {
      if (!(await canWriteDestination(destination, destinationIdentity, sourceIdentities))) return false
      await writeZip(destination, metadata, [], createLogReadStream)
      return 'not_included'
    }
    try {
      if (!(await canWriteDestination(destination, destinationIdentity, sourceIdentities))) return false
      await writeZip(destination, metadata, snapshots, createLogReadStream)
      return 'included'
    } catch (error) {
      if (!(error instanceof LogReadFailure)) throw error
      if (!(await canWriteDestination(destination, destinationIdentity, sourceIdentities))) return false
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
