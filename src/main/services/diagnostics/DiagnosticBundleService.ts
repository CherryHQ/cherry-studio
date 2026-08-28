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
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'
import { Mutex } from 'async-mutex'
import { dialog } from 'electron'

import { cherryDiagnosticUploadClient } from './CherryDiagnosticUploadClient'
import {
  buildScanReport,
  collectErrorLogRecords,
  diagnose,
  SCAN_REPORT_ARCHIVE_NAME,
  serializeScanReport
} from './scan'
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
type RetryUploadInput = InputFor<'diagnostics.bundle.retry_upload'>
type RetryUploadResult = OutputFor<'diagnostics.bundle.retry_upload'>
type SaveUploadInput = InputFor<'diagnostics.bundle.save_upload'>
type SaveUploadResult = OutputFor<'diagnostics.bundle.save_upload'>
type DiscardUploadInput = InputFor<'diagnostics.bundle.discard_upload'>
type DiscardUploadResult = OutputFor<'diagnostics.bundle.discard_upload'>

type RetainedUploadBundle =
  | {
      readonly bundleId: string
      readonly fileName: string
      readonly filePath: AbsoluteFilePath
      readonly location: 'saved'
    }
  | {
      readonly bundleId: string
      readonly fileName: string
      readonly filePath: AbsoluteFilePath
      readonly location: 'temporary'
      readonly tempRoot: AbsoluteFilePath
    }

interface RetainedUpload {
  bundle: RetainedUploadBundle
  readonly description: string
  readonly fileSha256?: string
}

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

interface InlineArchiveEntry {
  readonly name: string
  readonly content: string
}

async function writeBundleZip(
  destination: AbsoluteFilePath,
  expectedDestinationIdentity: DestinationIdentity,
  entries: readonly InlineArchiveEntry[],
  sources: readonly StagedSource[]
): Promise<void> {
  for (const entry of entries) assertSafeArchiveName(entry.name)
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
    for (const entry of entries) archive.append(entry.content, { name: entry.name })
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
  private readonly retainedUploads = new Map<string, RetainedUpload>()

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

  async retryUpload(input: RetryUploadInput): Promise<RetryUploadResult> {
    if (this.inFlightOperation) return { status: 'busy' }
    const operation = this.performRetryUpload(input)
    this.inFlightOperation = operation
    try {
      return await operation
    } finally {
      if (this.inFlightOperation === operation) this.inFlightOperation = null
    }
  }

  async saveUploadBundle(input: SaveUploadInput, senderId: WindowId | null): Promise<SaveUploadResult> {
    if (this.inFlightOperation) return { status: 'busy' }
    const operation = this.performSaveUpload(input, senderId)
    this.inFlightOperation = operation
    try {
      return await operation
    } finally {
      if (this.inFlightOperation === operation) this.inFlightOperation = null
    }
  }

  async discardUpload(input: DiscardUploadInput): Promise<DiscardUploadResult> {
    if (this.inFlightOperation) return { status: 'busy' }
    const operation = this.performDiscardUpload(input)
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
    const description = normalizeDiagnosticDescription(input.description.trim())
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
    let retainTempRoot = false

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

      const uploadResult = await cherryDiagnosticUploadClient.upload({
        description,
        fileName: bundle.fileName,
        filePath: bundle.filePath
      })
      if (uploadResult.status === 'uploaded') {
        return { reportId: uploadResult.reportId, status: 'uploaded' }
      }

      const retainedBundle: RetainedUploadBundle = {
        bundleId: bundle.bundleId,
        fileName: bundle.fileName,
        filePath: bundle.filePath,
        location: 'temporary',
        tempRoot
      }
      this.retainedUploads.set(bundle.bundleId, {
        bundle: retainedBundle,
        description,
        ...(uploadResult.fileSha256 ? { fileSha256: uploadResult.fileSha256 } : {})
      })
      retainTempRoot = true
      if (uploadResult.status === 'submission_unknown') {
        logger.warn('Diagnostic bundle submission result is unknown')
        return {
          bundleId: bundle.bundleId,
          fileName: bundle.fileName,
          status: 'submission_unknown'
        }
      }
      logger.warn('Diagnostic bundle submission failed', { reason: uploadResult.reason })
      return {
        bundleId: bundle.bundleId,
        fileName: bundle.fileName,
        reason: uploadResult.reason,
        status: 'submission_failed'
      }
    } finally {
      if (!retainTempRoot) {
        await removeDir(tempRoot).catch((error) => {
          logger.warn('Failed to clean diagnostic upload temporary files', {
            code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
          })
        })
      }
    }
  }

  private async performRetryUpload(input: RetryUploadInput): Promise<RetryUploadResult> {
    const retained = this.retainedUploads.get(input.bundleId)
    if (!retained) {
      throw new IpcError(
        diagnosticsErrorCodes.RETRY_NOT_AVAILABLE,
        'Diagnostic bundle is not available for retry in this process'
      )
    }

    const uploadResult = await cherryDiagnosticUploadClient.upload({
      description: retained.description,
      ...(retained.fileSha256 ? { expectedFileSha256: retained.fileSha256 } : {}),
      fileName: retained.bundle.fileName,
      filePath: retained.bundle.filePath
    })
    if (uploadResult.status === 'uploaded') {
      this.retainedUploads.delete(input.bundleId)
      await this.cleanupTemporaryUpload(retained.bundle)
      return { reportId: uploadResult.reportId, status: 'uploaded' }
    }
    if (uploadResult.status === 'submission_unknown') {
      logger.warn('Diagnostic bundle retry result is unknown')
      return {
        bundleId: retained.bundle.bundleId,
        fileName: retained.bundle.fileName,
        status: 'submission_unknown'
      }
    }
    logger.warn('Diagnostic bundle retry failed', { reason: uploadResult.reason })
    return {
      bundleId: retained.bundle.bundleId,
      fileName: retained.bundle.fileName,
      reason: uploadResult.reason,
      status: 'submission_failed'
    }
  }

  private async performSaveUpload(input: SaveUploadInput, senderId: WindowId | null): Promise<SaveUploadResult> {
    const retained = this.retainedUploads.get(input.bundleId)
    if (!retained) {
      throw new IpcError(
        diagnosticsErrorCodes.RETRY_NOT_AVAILABLE,
        'Diagnostic bundle is not available in this process'
      )
    }
    if (retained.bundle.location === 'saved') {
      return {
        bundleId: retained.bundle.bundleId,
        fileName: retained.bundle.fileName,
        filePath: retained.bundle.filePath,
        status: 'saved'
      }
    }
    const temporaryBundle = retained.bundle
    if (!senderId) throw new Error('Saving a diagnostic upload requires a managed window')
    const parent = application.get('WindowManager').getWindow(senderId)
    if (!parent) throw new Error('Diagnostic upload window is no longer available')

    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      defaultPath: retained.bundle.fileName,
      filters: [{ name: t('dialog.diagnostic_bundle.zip_filter'), extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      title: t('dialog.diagnostic_bundle.title')
    })
    if (canceled || !filePath) return { status: 'canceled' }

    const destination = AbsoluteFilePathSchema.parse(filePath)
    try {
      await assertDestinationOutsideSources(destination)
      const resolvedDestination = await resolveThroughExistingAncestor(destination)
      const resolvedTempRoot = await realpath(temporaryBundle.tempRoot)
      if (resolvedDestination === resolvedTempRoot || isPathInside(resolvedDestination, resolvedTempRoot)) {
        throw new Error('Diagnostic upload cannot be saved inside its temporary directory')
      }
      await move(temporaryBundle.filePath, destination)
      retained.bundle = {
        bundleId: temporaryBundle.bundleId,
        fileName: path.basename(destination),
        filePath: destination,
        location: 'saved'
      }
      await this.cleanupTemporaryUpload(temporaryBundle)
      return {
        bundleId: retained.bundle.bundleId,
        fileName: retained.bundle.fileName,
        filePath: destination,
        status: 'saved'
      }
    } catch {
      throw new IpcError(
        diagnosticsErrorCodes.FALLBACK_SAVE_FAILED,
        'Failed to preserve diagnostic bundle for manual upload'
      )
    }
  }

  private async performDiscardUpload(input: DiscardUploadInput): Promise<DiscardUploadResult> {
    const retained = this.retainedUploads.get(input.bundleId)
    if (!retained) return { status: 'not_found' }
    this.retainedUploads.delete(input.bundleId)
    await this.cleanupTemporaryUpload(retained.bundle)
    return { status: 'discarded' }
  }

  private async cleanupTemporaryUpload(bundle: RetainedUploadBundle): Promise<void> {
    if (bundle.location !== 'temporary') return
    await removeDir(bundle.tempRoot).catch((error) => {
      logger.warn('Failed to clean retained diagnostic upload temporary files', {
        code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
      })
    })
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

    // Mechanical error scan over the raw error logs. Gated on includeLogs so the
    // report cannot leak log contents the user opted out of; failure never blocks export.
    let scanReportJson: string | undefined
    let scan:
      | { status: 'included'; findingCount: number; truncated: boolean; skippedFileCount: number }
      | { status: 'skipped' }
      | { status: 'failed' } = { status: 'skipped' }
    if (input.includeLogs) {
      try {
        const scanned = await collectErrorLogRecords(application.getPath('app.logs'), range)
        const findings = diagnose(scanned.records)
        scanReportJson = serializeScanReport(
          buildScanReport(findings, {
            range,
            scannedRecordCount: scanned.records.length,
            unparsedLineCount: scanned.unparsedLineCount,
            skippedFileCount: scanned.skippedFileCount,
            truncated: scanned.truncated
          })
        )
        // an incomplete scan must be visible in the manifest: triage should not have to open
        // scan/findings.json to learn that most of the logs were never read
        scan = {
          status: 'included',
          findingCount: findings.length,
          truncated: scanned.truncated,
          skippedFileCount: scanned.skippedFileCount
        }
      } catch (error) {
        collection.warnings.add('scan_failed')
        scan = { status: 'failed' }
        logger.warn('Failed to build the diagnostic scan report', {
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
      scan,
      sources: {
        logs: { included: included.logs, omitted: omitted.logs },
        traces: { included: included.traces, omitted: omitted.traces }
      },
      warnings
    }

    const entries = [
      { name: 'diagnostics.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
      ...(scanReportJson !== undefined ? [{ name: SCAN_REPORT_ARCHIVE_NAME, content: scanReportJson }] : [])
    ]
    await writeBundleZip(destination, destinationIdentity, entries, staged)

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
