import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'

import { Mutex } from 'async-mutex'
import { dialog } from 'electron'

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

import {
  addChatRecordStats,
  type ChatRecordCandidate,
  type ChatRecordCollection,
  collectChatRecords,
  scanChatRecordStats,
  stageChatRecords
} from './chatRecordCollector'
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
  SourceChangedError,
  sourceStats,
  stageSourceCandidate
} from './sourceCollector'
import {
  compareBudgetCandidates,
  createDiagnosticBudgetSelector,
  type DiagnosticBudgetCandidate,
  toChatBudgetCandidate,
  toFileBudgetCandidate
} from './sourceSelection'
import { collectDiagnosticSystemInfo } from './systemInfo'
import type {
  ChatRecordStats,
  DiagnosticTimeRange,
  DiagnosticWarning,
  SourceCandidate,
  SourceCollection,
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
  readonly uploadFileName: string
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

function emptyChatRecordCollection(): ChatRecordCollection {
  return {
    candidates: (async function* () {})(),
    warnings: new Set()
  }
}

function mergeWarnings(target: Set<DiagnosticWarning>, source: ReadonlySet<DiagnosticWarning>): void {
  for (const warning of source) target.add(warning)
}

type BundleSourceCandidate = ChatRecordCandidate | SourceCandidate

async function selectBundleSources(
  fileCandidates: readonly SourceCandidate[],
  chatCollection: ChatRecordCollection
): Promise<{
  allChatStats: ChatRecordStats
  expectedChatArchiveNames: ReadonlySet<string>
  omittedChats: boolean
  omittedFiles: SourceCandidate[]
  selectedChats: ChatRecordCandidate[]
  selectedFiles: SourceCandidate[]
}> {
  const sortedFiles = fileCandidates.map(toFileBudgetCandidate).sort(compareBudgetCandidates)
  const chatIterator = chatCollection.candidates[Symbol.asyncIterator]()
  const selectedChats: ChatRecordCandidate[] = []
  const selectedFileCandidates = new Set<DiagnosticBudgetCandidate<SourceCandidate>>()
  const selector = createDiagnosticBudgetSelector(DIAGNOSTIC_SOURCE_LIMIT_BYTES)
  const chatContextRecordKeys = new Set<string>()
  const expectedChatArchiveNames = new Set<string>()
  const allChatStats: ChatRecordStats = { bytes: 0, messageCount: 0, recordCount: 0 }

  const observeChat = (candidate: ChatRecordCandidate): void => {
    addChatRecordStats(allChatStats, chatContextRecordKeys, candidate)
    expectedChatArchiveNames.add(candidate.messageRecord.archiveName)
    expectedChatArchiveNames.add(candidate.contextRecord.archiveName)
  }

  const trySelect = (candidate: DiagnosticBudgetCandidate<BundleSourceCandidate>): void => {
    if (!selector.trySelect(candidate)) return
    if (candidate.item.kind === 'chatRecords') {
      selectedChats.push(candidate.item)
    } else {
      selectedFileCandidates.add(candidate as DiagnosticBudgetCandidate<SourceCandidate>)
    }
  }

  const firstChatResult = await chatIterator.next()
  const firstChat = firstChatResult.done ? undefined : toChatBudgetCandidate(firstChatResult.value)
  if (firstChat) observeChat(firstChat.item)

  const representatives: DiagnosticBudgetCandidate<BundleSourceCandidate>[] = []
  for (const kind of ['logs', 'traces'] as const) {
    const representative = sortedFiles.find((candidate) => candidate.kind === kind)
    if (representative) representatives.push(representative)
  }
  if (firstChat) representatives.push(firstChat)
  for (const representative of representatives.sort(compareBudgetCandidates)) trySelect(representative)

  const representativeSet = new Set(representatives)
  const remainingFiles = sortedFiles.filter((candidate) => !representativeSet.has(candidate))
  let fileIndex = 0
  let chatResult = await chatIterator.next()
  let currentChat = chatResult.done ? undefined : toChatBudgetCandidate(chatResult.value)
  if (currentChat) observeChat(currentChat.item)

  while (fileIndex < remainingFiles.length || currentChat) {
    const file = remainingFiles[fileIndex]
    if (file && (!currentChat || compareBudgetCandidates(file, currentChat) <= 0)) {
      trySelect(file)
      fileIndex += 1
      continue
    }

    if (!currentChat) break
    trySelect(currentChat)
    chatResult = await chatIterator.next()
    currentChat = chatResult.done ? undefined : toChatBudgetCandidate(chatResult.value)
    if (currentChat) observeChat(currentChat.item)
  }

  return {
    allChatStats,
    expectedChatArchiveNames,
    omittedChats: allChatStats.messageCount > selectedChats.length,
    omittedFiles: sortedFiles
      .filter((candidate) => !selectedFileCandidates.has(candidate))
      .map((candidate) => candidate.item),
    selectedChats,
    selectedFiles: sortedFiles
      .filter((candidate) => selectedFileCandidates.has(candidate))
      .map((candidate) => candidate.item)
  }
}

function subtractChatStats(all: ChatRecordStats, included: ChatRecordStats): ChatRecordStats {
  return {
    bytes: all.bytes - included.bytes,
    messageCount: all.messageCount - included.messageCount,
    recordCount: all.recordCount - included.recordCount
  }
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
    const chatCollection = collectChatRecords(range)
    const chats = await scanChatRecordStats(chatCollection.candidates)
    mergeWarnings(collection.warnings, chatCollection.warnings)
    const crashDumps = await collectCrashDumpInventory(range, collection.warnings)

    return {
      hasWarnings: collection.warnings.size > 0,
      sourceLimitBytes: DIAGNOSTIC_SOURCE_LIMIT_BYTES,
      sources: {
        chatRecords: {
          available: chats.messageCount > 0,
          estimatedBytes: chats.bytes,
          messageCount: chats.messageCount
        },
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
    const chatCollection = input.includeChatRecords ? collectChatRecords(range) : emptyChatRecordCollection()
    const enabledFileCandidates = [...collection.logs, ...collection.traces]
    const destinationIdentity = await probeDestination(destination)
    if (enabledFileCandidates.some((candidate) => isSamePhysicalFile(destinationIdentity, candidate))) {
      throw new IpcError(
        diagnosticsErrorCodes.DESTINATION_IS_SOURCE,
        'Diagnostic bundle destination matches a source file'
      )
    }

    const selection = await selectBundleSources(enabledFileCandidates, chatCollection)
    mergeWarnings(collection.warnings, chatCollection.warnings)
    if (selection.omittedFiles.length > 0 || selection.omittedChats) {
      collection.warnings.add('size_limit_reached')
    }

    const tempRoot = AbsoluteFilePathSchema.parse(await mkdtemp(application.getPath('app.temp', 'diagnostic-bundle-')))
    try {
      return await this.buildBundle({
        bundleId: randomUUID(),
        allChatStats: selection.allChatStats,
        collection,
        destination,
        destinationIdentity,
        expectedChatArchiveNames: selection.expectedChatArchiveNames,
        input,
        range,
        selectedChats: selection.selectedChats,
        selectedFiles: selection.selectedFiles,
        sizeOmittedFiles: selection.omittedFiles,
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
        const chatCollection = input.includeChatRecords ? collectChatRecords(range) : emptyChatRecordCollection()
        const selection = await selectBundleSources([...collection.logs, ...collection.traces], chatCollection)
        mergeWarnings(collection.warnings, chatCollection.warnings)
        if (selection.omittedFiles.length > 0 || selection.omittedChats) {
          collection.warnings.add('size_limit_reached')
        }
        bundle = await this.buildBundle({
          allChatStats: selection.allChatStats,
          bundleId,
          collection,
          destination,
          destinationIdentity: { status: 'missing' },
          expectedChatArchiveNames: selection.expectedChatArchiveNames,
          input,
          range,
          selectedChats: selection.selectedChats,
          selectedFiles: selection.selectedFiles,
          sizeOmittedFiles: selection.omittedFiles,
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
        uploadFileName: bundle.fileName,
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
      fileName: retained.uploadFileName,
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
    allChatStats,
    bundleId,
    collection,
    destination,
    destinationIdentity,
    expectedChatArchiveNames,
    input,
    range,
    selectedChats,
    selectedFiles,
    sizeOmittedFiles,
    tempRoot,
    uploadedAutomatically
  }: {
    allChatStats: ChatRecordStats
    bundleId: string
    collection: SourceCollection
    destination: AbsoluteFilePath
    destinationIdentity: DestinationIdentity
    expectedChatArchiveNames: ReadonlySet<string>
    input: ExportInput
    range: DiagnosticTimeRange
    selectedChats: ChatRecordCandidate[]
    selectedFiles: SourceCandidate[]
    sizeOmittedFiles: SourceCandidate[]
    tempRoot: AbsoluteFilePath
    uploadedAutomatically: boolean
  }): Promise<SavedBundle> {
    const staged: StagedSource[] = []
    const failedCandidates: SourceCandidate[] = []

    for (const [index, candidate] of selectedFiles.entries()) {
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

    let includedChatStats: ChatRecordStats = { bytes: 0, messageCount: 0, recordCount: 0 }
    let adjustedAllChatStats = allChatStats
    if (selectedChats.length > 0) {
      try {
        const stagedFileBytes = staged.reduce((bytes, source) => bytes + source.bytes, 0)
        const chatResult = await stageChatRecords(
          selectedChats,
          tempRoot,
          Math.max(0, DIAGNOSTIC_SOURCE_LIMIT_BYTES - stagedFileBytes)
        )
        staged.push(...chatResult.sources)
        includedChatStats = chatResult.included
        adjustedAllChatStats = { ...allChatStats, bytes: allChatStats.bytes + chatResult.observedByteDelta }
        mergeWarnings(collection.warnings, chatResult.warnings)
      } catch (error) {
        collection.warnings.add('source_unreadable')
        logger.warn('Skipped diagnostic chat records that could not be staged', {
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
      chatRecords: includedChatStats,
      logs: stagedStats(staged, 'logs'),
      traces: stagedStats(staged, 'traces')
    }
    const omittedCandidates = [...sizeOmittedFiles, ...failedCandidates]
    const omitted = {
      chatRecords: subtractChatStats(adjustedAllChatStats, included.chatRecords),
      logs: candidateStats(omittedCandidates, 'logs'),
      traces: candidateStats(omittedCandidates, 'traces')
    }
    const serializedRange = serializeTimeRange(range)
    const warnings = warningsArray(collection.warnings)
    const manifest = {
      schemaVersion: 2,
      bundleId,
      createdAt: new Date(range.toMs).toISOString(),
      range: serializedRange,
      privacy: {
        containsUnredactedData: input.includeChatRecords || input.includeLogs || input.includeTraces,
        publiclyShareable: false,
        uploadedAutomatically
      },
      selection: {
        includeChatRecords: input.includeChatRecords,
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
        chatRecords: { included: included.chatRecords, omitted: omitted.chatRecords },
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
    const stagedChatArchiveNames = new Set(
      staged.filter((source) => source.kind === 'chatRecords').map((source) => source.archiveName)
    )
    const omittedChatArchiveCount = [...expectedChatArchiveNames].filter(
      (archiveName) => !stagedChatArchiveNames.has(archiveName)
    ).length
    return {
      archiveBytes,
      bundleId,
      filePath: destination,
      fileName: path.basename(destination),
      hasWarnings: warnings.length > 0,
      includedFileCount: staged.length,
      omittedFileCount: omitted.logs.fileCount + omitted.traces.fileCount + omittedChatArchiveCount,
      status: 'saved'
    }
  }
}

export const diagnosticBundleService = new DiagnosticBundleService()
