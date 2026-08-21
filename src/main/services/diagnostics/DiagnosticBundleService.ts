import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import {
  createAtomicWriteStream,
  isPathInside,
  move,
  openReadableFileSnapshot,
  type ReadableFileSnapshot,
  realpath,
  remove,
  removeDir,
  stat
} from '@main/utils/file'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { DiagnosticRange } from '@shared/ipc/schemas/diagnostics'
import type { InputFor, OutputFor, WindowId } from '@shared/ipc/types'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { Mutex } from 'async-mutex'
import { dialog } from 'electron'

import { feishuAnonymousFormClient } from './FeishuAnonymousFormClient'
import {
  collectCrashDumpInventory,
  collectDiagnosticSources,
  selectSourceCandidates,
  SourceChangedError,
  sourceStats,
  stageSourceCandidate
} from './sourceCollector'
import { collectDiagnosticSystemInfo } from './systemInfo'
import type {
  DiagnosticTimeRange,
  DiagnosticWarning,
  SourceCandidate,
  SourceIdentity,
  SourceStats,
  StagedSource
} from './types'

const logger = loggerService.withContext('DiagnosticBundleService')

export const DIAGNOSTIC_SOURCE_LIMIT_BYTES = 50 * 1024 * 1024

const RANGE_DURATION_MS: Record<DiagnosticRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

type InspectResult = OutputFor<'diagnostics.bundle.inspect'>
type ExportInput = InputFor<'diagnostics.bundle.export'>
type ExportResult = OutputFor<'diagnostics.bundle.export'>
type SavedBundle = Extract<ExportResult, { status: 'saved' }>
type UploadInput = InputFor<'diagnostics.bundle.upload'>
type UploadResult = OutputFor<'diagnostics.bundle.upload'>

type DestinationIdentity = { readonly status: 'missing' } | ({ readonly status: 'present' } & SourceIdentity)

function toTimeRange(range: DiagnosticRange, now: number): DiagnosticTimeRange {
  return { fromMs: now - RANGE_DURATION_MS[range], toMs: now }
}

function serializeTimeRange(range: DiagnosticTimeRange): { from: string; to: string } {
  return { from: new Date(range.fromMs).toISOString(), to: new Date(range.toMs).toISOString() }
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function warningsArray(warnings: Set<DiagnosticWarning>): DiagnosticWarning[] {
  return [...warnings].sort()
}

function emptyStats(): SourceStats {
  return { bytes: 0, fileCount: 0, malformedLineCount: 0 }
}

function stagedStats(sources: readonly StagedSource[], kind: 'logs' | 'traces'): SourceStats {
  return sources
    .filter((source) => source.kind === kind)
    .reduce<SourceStats>(
      (stats, source) => ({
        bytes: stats.bytes + source.bytes,
        fileCount: stats.fileCount + 1,
        malformedLineCount: stats.malformedLineCount + source.malformedLineCount
      }),
      emptyStats()
    )
}

function candidateStats(candidates: readonly SourceCandidate[], kind: 'logs' | 'traces'): SourceStats {
  return sourceStats(candidates.filter((candidate) => candidate.kind === kind))
}

function assertSafeArchiveName(name: string): void {
  const segments = name.split('/')
  if (
    !name ||
    path.posix.isAbsolute(name) ||
    name.includes('\\') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid ZIP entry name')
  }
}

async function writeBundleZip(
  destination: AbsoluteFilePath,
  expectedDestinationIdentity: DestinationIdentity,
  manifest: string,
  sources: readonly StagedSource[]
): Promise<void> {
  for (const source of sources) assertSafeArchiveName(source.archiveName)

  const { ZipArchive } = await import('archiver')
  const stagingPath = AbsoluteFilePathSchema.parse(
    path.join(path.dirname(destination), `.cherry-studio-diagnostics-${randomUUID()}.tmp`)
  )
  const output = createAtomicWriteStream(stagingPath)
  const archive = new ZipArchive({ zlib: { level: 1 } })
  const completion = new Promise<void>((resolve, reject) => {
    output.once('finish', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.once('warning', reject)
  })

  try {
    archive.pipe(output)
    archive.append(manifest, { name: 'diagnostics.json' })
    for (const source of sources) archive.file(source.path, { name: source.archiveName })
    await Promise.all([archive.finalize(), completion])
    const currentDestinationIdentity = await probeDestination(destination)
    if (!sameDestinationIdentity(expectedDestinationIdentity, currentDestinationIdentity)) {
      throw new Error('Diagnostic bundle destination changed before it could be written')
    }
    await move(stagingPath, destination)
  } catch (error) {
    archive.abort()
    if (!output.closed) await output.abort().catch(() => undefined)
    throw error
  } finally {
    await remove(stagingPath).catch((error) => {
      logger.warn('Failed to clean diagnostic bundle staging archive', {
        code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
      })
    })
  }
}

async function probeDestination(destination: AbsoluteFilePath): Promise<DestinationIdentity> {
  let snapshot: ReadableFileSnapshot | undefined
  try {
    snapshot = await openReadableFileSnapshot(destination)
    return {
      status: 'present',
      dev: snapshot.dev,
      ino: snapshot.ino,
      modifiedAt: snapshot.modifiedAt,
      size: snapshot.size
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'missing' }
    throw error
  } finally {
    await snapshot?.close().catch(() => undefined)
  }
}

function sameDestinationIdentity(a: DestinationIdentity, b: DestinationIdentity): boolean {
  if (a.status !== b.status) return false
  if (a.status === 'missing' || b.status === 'missing') return true
  return a.dev === b.dev && a.ino === b.ino && a.modifiedAt === b.modifiedAt && a.size === b.size
}

function isSamePhysicalFile(destination: DestinationIdentity, candidate: SourceCandidate): boolean {
  return (
    destination.status === 'present' &&
    destination.dev === candidate.identity.dev &&
    destination.ino === candidate.identity.ino
  )
}

async function resolveThroughExistingAncestor(target: AbsoluteFilePath): Promise<AbsoluteFilePath> {
  try {
    return await realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    const parent = AbsoluteFilePathSchema.parse(path.dirname(target))
    if (parent === target) throw error
    const resolvedParent = await resolveThroughExistingAncestor(parent)
    return AbsoluteFilePathSchema.parse(path.join(resolvedParent, path.basename(target)))
  }
}

async function assertDestinationOutsideSources(destination: AbsoluteFilePath): Promise<void> {
  const sourceRoots = [
    application.getPath('app.logs'),
    application.getPath('app.crash_dumps'),
    application.getPath('feature.trace')
  ].map((root) => AbsoluteFilePathSchema.parse(root))
  const destinationParent = await resolveThroughExistingAncestor(
    AbsoluteFilePathSchema.parse(path.dirname(destination))
  )
  const resolvedDestination = AbsoluteFilePathSchema.parse(path.join(destinationParent, path.basename(destination)))
  const resolvedRoots = await Promise.all(sourceRoots.map((root) => resolveThroughExistingAncestor(root)))
  if (resolvedRoots.some((root) => isPathInside(resolvedDestination, root))) {
    throw new IpcError(
      diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE,
      'Diagnostic bundle destination cannot be inside a diagnostic source directory'
    )
  }
}

export class DiagnosticBundleService {
  private readonly inspectionMutex = new Mutex()
  private inFlightOperation: Promise<unknown> | null = null

  async inspect(rangeName: DiagnosticRange): Promise<InspectResult> {
    return this.inspectionMutex.runExclusive(() => this.performInspection(rangeName))
  }

  private async performInspection(rangeName: DiagnosticRange): Promise<InspectResult> {
    const range = toTimeRange(rangeName, Date.now())
    const collection = await collectDiagnosticSources(range, { includeLogs: true, includeTraces: true })
    const crashDumps = await collectCrashDumpInventory(range, collection.warnings)

    return {
      hasWarnings: collection.warnings.size > 0,
      sourceLimitBytes: DIAGNOSTIC_SOURCE_LIMIT_BYTES,
      sources: {
        crashDumps: { fileCount: crashDumps.files.length },
        logs: {
          available: collection.logs.length > 0,
          estimatedBytes: sourceStats(collection.logs).bytes,
          fileCount: collection.logs.length
        },
        traces: {
          available: collection.traces.length > 0,
          estimatedBytes: sourceStats(collection.traces).bytes,
          fileCount: collection.traces.length
        }
      }
    }
  }

  async exportBundle(input: ExportInput, senderId: WindowId | null): Promise<ExportResult> {
    if (this.inFlightOperation) return { status: 'busy' }
    const operation = this.performExport(input, senderId)
    this.inFlightOperation = operation
    try {
      return await operation
    } finally {
      if (this.inFlightOperation === operation) this.inFlightOperation = null
    }
  }

  async uploadBundle(input: UploadInput): Promise<UploadResult> {
    if (this.inFlightOperation) return { status: 'busy' }
    const operation = this.performUpload(input)
    this.inFlightOperation = operation
    try {
      return await operation
    } finally {
      if (this.inFlightOperation === operation) this.inFlightOperation = null
    }
  }

  private async performExport(input: ExportInput, senderId: WindowId | null): Promise<ExportResult> {
    if (!senderId) throw new Error('Diagnostic bundle export requires a managed window')
    const parent = application.get('WindowManager').getWindow(senderId)
    if (!parent) throw new Error('Diagnostic bundle export window is no longer available')

    const dialogOpenedAt = new Date()
    const suggestedFileName = `cherry-studio-diagnostics-${formatTimestamp(dialogOpenedAt)}.zip`
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      defaultPath: suggestedFileName,
      filters: [{ name: t('dialog.diagnostic_bundle.zip_filter'), extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      title: t('dialog.diagnostic_bundle.title')
    })
    if (canceled || !filePath) return { status: 'canceled' }

    const destination = AbsoluteFilePathSchema.parse(filePath)
    await assertDestinationOutsideSources(destination)
    const range = toTimeRange(input.range, Date.now())
    const collection = await collectDiagnosticSources(range, input)
    const enabledCandidates = [...collection.logs, ...collection.traces]
    const destinationIdentity = await probeDestination(destination)
    if (enabledCandidates.some((candidate) => isSamePhysicalFile(destinationIdentity, candidate))) {
      throw new IpcError(
        diagnosticsErrorCodes.DESTINATION_IS_SOURCE,
        'Diagnostic bundle destination matches a source file'
      )
    }

    const selection = selectSourceCandidates(enabledCandidates, DIAGNOSTIC_SOURCE_LIMIT_BYTES)
    if (selection.omitted.length > 0) collection.warnings.add('size_limit_reached')

    const tempRoot = AbsoluteFilePathSchema.parse(await mkdtemp(application.getPath('app.temp', 'diagnostic-bundle-')))
    try {
      return await this.buildBundle({
        bundleId: randomUUID(),
        collection,
        destination,
        destinationIdentity,
        input,
        range,
        selected: selection.selected,
        sizeOmitted: selection.omitted,
        tempRoot,
        uploadedAutomatically: false
      })
    } finally {
      await removeDir(tempRoot).catch((error) => {
        logger.warn('Failed to clean diagnostic bundle temporary files', {
          code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
        })
      })
    }
  }

  private async performUpload(input: UploadInput): Promise<UploadResult> {
    const createdAt = new Date()
    const bundleId = randomUUID()
    const fileName = `cherry-studio-diagnostics-${formatTimestamp(createdAt)}-${bundleId}.zip`
    let tempRoot: AbsoluteFilePath
    try {
      tempRoot = AbsoluteFilePathSchema.parse(await mkdtemp(application.getPath('app.temp', 'diagnostic-upload-')))
    } catch {
      throw new IpcError(diagnosticsErrorCodes.BUNDLE_BUILD_FAILED, 'Failed to build diagnostic bundle')
    }
    const destination = AbsoluteFilePathSchema.parse(path.join(tempRoot, fileName))

    try {
      let bundle: SavedBundle
      try {
        const range = toTimeRange(input.range, Date.now())
        const collection = await collectDiagnosticSources(range, input)
        const enabledCandidates = [...collection.logs, ...collection.traces]
        const selection = selectSourceCandidates(enabledCandidates, DIAGNOSTIC_SOURCE_LIMIT_BYTES)
        if (selection.omitted.length > 0) collection.warnings.add('size_limit_reached')
        bundle = await this.buildBundle({
          bundleId,
          collection,
          destination,
          destinationIdentity: { status: 'missing' },
          input,
          range,
          selected: selection.selected,
          sizeOmitted: selection.omitted,
          tempRoot,
          uploadedAutomatically: true
        })
      } catch {
        throw new IpcError(diagnosticsErrorCodes.BUNDLE_BUILD_FAILED, 'Failed to build diagnostic bundle')
      }

      const uploadResult = await feishuAnonymousFormClient.upload({
        fileName: bundle.fileName,
        filePath: bundle.filePath,
        fileSize: bundle.archiveBytes
      })
      if (uploadResult.status === 'uploaded') {
        return {
          archiveBytes: bundle.archiveBytes,
          bundleId: bundle.bundleId,
          hasWarnings: bundle.hasWarnings,
          includedFileCount: bundle.includedFileCount,
          omittedFileCount: bundle.omittedFileCount,
          status: 'uploaded'
        }
      }

      let savedBundle: Omit<SavedBundle, 'status'>
      try {
        savedBundle = await this.saveUploadFallback(bundle)
      } catch (error) {
        if (uploadResult.status === 'submission_unknown') {
          throw new IpcError(
            diagnosticsErrorCodes.SUBMISSION_UNKNOWN_FALLBACK_SAVE_FAILED,
            'Diagnostic submission may have succeeded, but its fallback could not be preserved'
          )
        }
        throw error
      }
      if (uploadResult.status === 'submission_unknown') {
        logger.warn('Diagnostic bundle submission result is unknown')
        return { ...savedBundle, status: 'submission_unknown' }
      }
      logger.warn('Diagnostic bundle requires manual upload', { reason: uploadResult.reason })
      return {
        fileName: savedBundle.fileName,
        filePath: savedBundle.filePath,
        reason: uploadResult.reason,
        status: 'manual_upload_required'
      }
    } finally {
      await removeDir(tempRoot).catch((error) => {
        logger.warn('Failed to clean diagnostic upload temporary files', {
          code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
        })
      })
    }
  }

  private async saveUploadFallback(bundle: SavedBundle): Promise<Omit<SavedBundle, 'status'>> {
    const destination = AbsoluteFilePathSchema.parse(application.getPath('sys.downloads', bundle.fileName))
    try {
      if ((await probeDestination(destination)).status !== 'missing') {
        throw new Error('Fallback destination already exists')
      }
      await move(bundle.filePath, destination)
      return {
        archiveBytes: bundle.archiveBytes,
        bundleId: bundle.bundleId,
        fileName: bundle.fileName,
        filePath: destination,
        hasWarnings: bundle.hasWarnings,
        includedFileCount: bundle.includedFileCount,
        omittedFileCount: bundle.omittedFileCount
      }
    } catch {
      throw new IpcError(
        diagnosticsErrorCodes.FALLBACK_SAVE_FAILED,
        'Failed to preserve diagnostic bundle for manual upload'
      )
    }
  }

  private async buildBundle({
    bundleId,
    collection,
    destination,
    destinationIdentity,
    input,
    range,
    selected,
    sizeOmitted,
    tempRoot,
    uploadedAutomatically
  }: {
    bundleId: string
    collection: Awaited<ReturnType<typeof collectDiagnosticSources>>
    destination: AbsoluteFilePath
    destinationIdentity: DestinationIdentity
    input: ExportInput
    range: DiagnosticTimeRange
    selected: SourceCandidate[]
    sizeOmitted: SourceCandidate[]
    tempRoot: AbsoluteFilePath
    uploadedAutomatically: boolean
  }): Promise<SavedBundle> {
    const staged: StagedSource[] = []
    const failedCandidates: SourceCandidate[] = []

    for (const [index, candidate] of selected.entries()) {
      const stagedPath = AbsoluteFilePathSchema.parse(path.join(tempRoot, `source-${index}.jsonl`))
      try {
        staged.push(await stageSourceCandidate(candidate, range, stagedPath))
      } catch (error) {
        failedCandidates.push(candidate)
        collection.warnings.add(error instanceof SourceChangedError ? 'source_changed' : 'source_unreadable')
        logger.warn('Skipped a diagnostic source that could not be staged', {
          code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
        })
      }
    }

    const crashDumps = await collectCrashDumpInventory(range, collection.warnings)
    const system = await collectDiagnosticSystemInfo(collection.warnings)
    const included = {
      logs: stagedStats(staged, 'logs'),
      traces: stagedStats(staged, 'traces')
    }
    const omittedCandidates = [...sizeOmitted, ...failedCandidates]
    const omitted = {
      logs: candidateStats(omittedCandidates, 'logs'),
      traces: candidateStats(omittedCandidates, 'traces')
    }
    const serializedRange = serializeTimeRange(range)
    const warnings = warningsArray(collection.warnings)
    const manifest = {
      schemaVersion: 1,
      bundleId,
      createdAt: new Date(range.toMs).toISOString(),
      range: serializedRange,
      privacy: {
        containsUnredactedData: input.includeLogs || input.includeTraces,
        publiclyShareable: false,
        uploadedAutomatically
      },
      selection: {
        includeLogs: input.includeLogs,
        includeSystemInformation: true,
        includeTraces: input.includeTraces,
        persistedTracesOnly: true
      },
      sourceLimitBytes: DIAGNOSTIC_SOURCE_LIMIT_BYTES,
      system,
      crashDumps: {
        files: crashDumps.files,
        mode: 'inventory_only',
        totalBytes: crashDumps.totalBytes
      },
      sources: {
        logs: { included: included.logs, omitted: omitted.logs },
        traces: { included: included.traces, omitted: omitted.traces }
      },
      warnings
    }

    await writeBundleZip(destination, destinationIdentity, `${JSON.stringify(manifest, null, 2)}\n`, staged)

    const archiveBytes = (await stat(destination)).size
    return {
      archiveBytes,
      bundleId,
      filePath: destination,
      fileName: path.basename(destination),
      hasWarnings: warnings.length > 0,
      includedFileCount: included.logs.fileCount + included.traces.fileCount,
      omittedFileCount: omitted.logs.fileCount + omitted.traces.fileCount,
      status: 'saved'
    }
  }
}

export const diagnosticBundleService = new DiagnosticBundleService()
