import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import {
  type AtomicZipEntry,
  isPathInside,
  openReadableFileSnapshot,
  probeReadable,
  type ReadableFileSnapshot,
  realpath,
  removeDir,
  stat,
  writeAtomicZip
} from '@main/utils/file'
import type { DiagnosticRange, DiagnosticWarning } from '@shared/ipc/schemas/diagnostics'
import type { InputFor, OutputFor, WindowId } from '@shared/ipc/types'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { dialog, shell } from 'electron'

import {
  collectCrashDumpInventory,
  collectDiagnosticSources,
  selectSourceCandidates,
  SourceChangedError,
  sourceStats,
  stageSourceCandidate
} from './sourceCollector'
import { collectDiagnosticSystemInfo } from './systemInfo'
import type { DiagnosticTimeRange, SourceCandidate, SourceIdentity, SourceStats, StagedSource } from './types'

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
    throw new Error('Diagnostic bundle destination cannot be inside a diagnostic source directory')
  }
}

function selectedCandidates(collection: Awaited<ReturnType<typeof collectDiagnosticSources>>, input: ExportInput) {
  return [...(input.includeLogs ? collection.logs : []), ...(input.includeTraces ? collection.traces : [])]
}

export class DiagnosticBundleService {
  private inFlightExport: Promise<ExportResult> | null = null
  private lastSavedPath: AbsoluteFilePath | null = null

  async inspect(rangeName: DiagnosticRange): Promise<InspectResult> {
    const range = toTimeRange(rangeName, Date.now())
    const collection = await collectDiagnosticSources(range)
    const crashDumps = await collectCrashDumpInventory(range, collection.warnings)

    return {
      range: serializeTimeRange(range),
      sourceLimitBytes: DIAGNOSTIC_SOURCE_LIMIT_BYTES,
      sources: {
        crashDumps: {
          available: crashDumps.files.length > 0,
          estimatedBytes: crashDumps.totalBytes,
          fileCount: crashDumps.files.length
        },
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
      },
      warnings: warningsArray(collection.warnings)
    }
  }

  async exportBundle(input: ExportInput, senderId: WindowId | null): Promise<ExportResult> {
    if (this.inFlightExport) return { status: 'busy' }
    const operation = this.performExport(input, senderId)
    this.inFlightExport = operation
    try {
      return await operation
    } finally {
      if (this.inFlightExport === operation) this.inFlightExport = null
    }
  }

  async revealLastBundle(): Promise<boolean> {
    const lastSavedPath = this.lastSavedPath
    if (!lastSavedPath || (await probeReadable(lastSavedPath)) !== 'readable') return false
    try {
      shell.showItemInFolder(lastSavedPath)
      return true
    } catch (error) {
      logger.warn('Failed to reveal the last diagnostic bundle', {
        code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
      })
      return false
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
    const collection = await collectDiagnosticSources(range)
    const enabledCandidates = selectedCandidates(collection, input)
    const destinationIdentity = await probeDestination(destination)
    if (enabledCandidates.some((candidate) => isSamePhysicalFile(destinationIdentity, candidate))) {
      throw new Error('Diagnostic bundle destination matches a source file')
    }

    const selection = selectSourceCandidates(enabledCandidates, DIAGNOSTIC_SOURCE_LIMIT_BYTES)
    if (selection.omitted.length > 0) collection.warnings.add('size_limit_reached')

    const tempRoot = AbsoluteFilePathSchema.parse(await mkdtemp(application.getPath('app.temp', 'diagnostic-bundle-')))
    try {
      return await this.buildBundle({
        collection,
        destination,
        destinationIdentity,
        input,
        range,
        selected: selection.selected,
        sizeOmitted: selection.omitted,
        tempRoot
      })
    } finally {
      await removeDir(tempRoot).catch((error) => {
        logger.warn('Failed to clean diagnostic bundle temporary files', {
          code: (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
        })
      })
    }
  }

  private async buildBundle({
    collection,
    destination,
    destinationIdentity,
    input,
    range,
    selected,
    sizeOmitted,
    tempRoot
  }: {
    collection: Awaited<ReturnType<typeof collectDiagnosticSources>>
    destination: AbsoluteFilePath
    destinationIdentity: DestinationIdentity
    input: ExportInput
    range: DiagnosticTimeRange
    selected: SourceCandidate[]
    sizeOmitted: SourceCandidate[]
    tempRoot: AbsoluteFilePath
  }): Promise<ExportResult> {
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
    const bundleId = randomUUID()
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
        uploadedAutomatically: false
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

    const entries: AtomicZipEntry[] = [
      { name: 'diagnostics.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
      ...staged.map((source) => ({
        name: source.archiveName,
        expectedBytes: source.bytes,
        createReadStream: () => createReadStream(source.path)
      }))
    ]
    const currentDestinationIdentity = await probeDestination(destination)
    if (!sameDestinationIdentity(destinationIdentity, currentDestinationIdentity)) {
      throw new Error('Diagnostic bundle destination changed before it could be written')
    }
    await writeAtomicZip(destination, entries)

    const archiveBytes = (await stat(destination)).size
    this.lastSavedPath = destination
    return {
      archiveBytes,
      bundleId,
      fileName: path.basename(destination),
      included,
      omitted,
      range: serializedRange,
      status: 'saved',
      warnings
    }
  }
}

export const diagnosticBundleService = new DiagnosticBundleService()
