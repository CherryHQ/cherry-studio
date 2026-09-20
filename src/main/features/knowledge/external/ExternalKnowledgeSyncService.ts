import { createHash } from 'node:crypto'

import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import {
  ExternalKnowledgeDocumentOwnershipChangedError,
  type ExternalKnowledgeDocumentSyncMetadata,
  type ExternalKnowledgeDocumentVersion,
  type ExternalKnowledgeDocumentWarningMetadata,
  type ExternalKnowledgeSourceSyncFence,
  externalKnowledgeDocumentService
} from '@data/services/ExternalKnowledgeDocumentService'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ExternalKnowledgeSource } from '@shared/data/types/externalKnowledge'
import {
  isCompletedKnowledgeBase,
  isCompletedVectorKnowledgeBase,
  type KnowledgeItemOf,
  KnowledgeRelativePathSchema
} from '@shared/data/types/knowledge'

import { prepareKnowledgeMaterial } from '../ingestion/indexKnowledgeItem'
import { deleteKnowledgeItemFiles, writeFileIntoKnowledgeBaseAt } from '../pathStorage'
import type { RebuildMaterialInput } from '../pipeline/vectorstore/indexStore/model'
import { ExternalKnowledgeRuntimeError, type ExternalKnowledgeRuntimeErrorCode } from './ExternalKnowledgeRuntime'
import type { FeishuKnowledgeReference, FeishuKnowledgeSourceScanResult } from './feishuKnowledgeReadAdapter'

const logger = loggerService.withContext('Knowledge:ExternalKnowledgeSync')

type ExternalKnowledgeIndexStore = {
  listExistingEmbeddingHashes(hashes: string[]): Set<string>
  rebuildMaterial(itemId: string, input: RebuildMaterialInput): void
  deleteMaterials(itemIds: string[]): Promise<void>
}

export type ExternalKnowledgeSyncDependencies = {
  createItemId(): string
  now(): number
  writeFileIntoKnowledgeBaseAt: typeof writeFileIntoKnowledgeBaseAt
  deleteKnowledgeItemFiles: typeof deleteKnowledgeItemFiles
  prepareKnowledgeMaterial: typeof prepareKnowledgeMaterial
  getIndexStore(base: Parameters<typeof prepareKnowledgeMaterial>[0]['base']): ExternalKnowledgeIndexStore
}

export type SyncExternalKnowledgeDocumentInput = {
  fence: ExternalKnowledgeSourceSyncFence
  reference: FeishuKnowledgeReference
  observedAt: number
  signal: AbortSignal
  reportProgress: Parameters<typeof prepareKnowledgeMaterial>[0]['reportProgress']
}

export type SyncExternalKnowledgeSourceInput = Pick<
  SyncExternalKnowledgeDocumentInput,
  'fence' | 'signal' | 'reportProgress'
>

export type ExternalKnowledgeSyncWarning =
  | 'stale-publication'
  | 'staged-vector-cleanup-failed'
  | 'staged-snapshot-cleanup-failed'
  | 'old-vector-cleanup-failed'
  | 'old-snapshot-cleanup-failed'

type ExternalKnowledgeArtifactCleanupWarning = Exclude<ExternalKnowledgeSyncWarning, 'stale-publication'>

export type ExternalKnowledgeDocumentSyncResult = {
  outcome: 'indexed' | 'unchanged' | 'skipped'
  warnings: ExternalKnowledgeSyncWarning[]
}

export type ExternalKnowledgeSourceSyncWarningCode =
  | PerDocumentRuntimeWarningCode
  | 'resource-permission-denied'
  | Exclude<ExternalKnowledgeSyncWarning, 'stale-publication'>
  | 'document-sync-failed'
  | 'missing-vector-cleanup-failed'
  | 'missing-snapshot-cleanup-failed'
  | 'permission-vector-cleanup-failed'
  | 'permission-snapshot-cleanup-failed'

export type ExternalKnowledgeSourceSyncWarning = {
  code: ExternalKnowledgeSourceSyncWarningCode
  remoteObjectId?: string
}

export type ExternalKnowledgeSourceSyncSummary = {
  scannedCount: number
  indexedCount: number
  unchangedCount: number
  skippedCount: number
  warningCount: number
  warnings: ExternalKnowledgeSourceSyncWarning[]
}

export type ExternalKnowledgeSourceSyncErrorCode =
  | ExternalKnowledgeRuntimeErrorCode
  | 'cancelled'
  | 'scan-failed'
  | 'stale-publication'
  | 'reconciliation-failed'

export class ExternalKnowledgeSourceSyncError extends Error {
  constructor(
    readonly code: ExternalKnowledgeSourceSyncErrorCode,
    readonly summary: ExternalKnowledgeSourceSyncSummary
  ) {
    super(`External knowledge source synchronization failed: ${code}`)
    this.name = 'ExternalKnowledgeSourceSyncError'
  }
}

type ExternalKnowledgeReadRuntime = {
  scanFeishuSource(
    connectionId: string,
    input: { spaceId: string; scope: ExternalKnowledgeSource['scope'] },
    signal?: AbortSignal
  ): Promise<FeishuKnowledgeSourceScanResult>
  readFeishuDocument(
    connectionId: string,
    reference: FeishuKnowledgeReference,
    signal?: AbortSignal
  ): Promise<{ content: string }>
}

class StaleExternalKnowledgePublicationError extends Error {}

class ExternalKnowledgeDocumentReadError extends Error {
  constructor(readonly code: ExternalKnowledgeRuntimeErrorCode) {
    super(`External knowledge document read failed: ${code}`)
    this.name = 'ExternalKnowledgeDocumentReadError'
  }
}

class ExternalKnowledgeDocumentSyncFailure extends Error {
  constructor(readonly cleanupWarnings: ExternalKnowledgeArtifactCleanupWarning[]) {
    super('External knowledge document synchronization failed')
    this.name = 'ExternalKnowledgeDocumentSyncFailure'
  }
}

const defaultDependencies: ExternalKnowledgeSyncDependencies = {
  createItemId: uuidv7,
  now: Date.now,
  writeFileIntoKnowledgeBaseAt,
  deleteKnowledgeItemFiles,
  prepareKnowledgeMaterial,
  getIndexStore: (base) => application.get('KnowledgeVectorStoreService').getIndexStore(base)
}

const PER_DOCUMENT_RUNTIME_WARNING_CODES = [
  'transient',
  'invalid-provider-response',
  'unsupported-resource'
] as const satisfies readonly ExternalKnowledgeRuntimeErrorCode[]

type PerDocumentRuntimeWarningCode = (typeof PER_DOCUMENT_RUNTIME_WARNING_CODES)[number]

function isPerDocumentRuntimeWarningCode(
  code: ExternalKnowledgeRuntimeErrorCode
): code is PerDocumentRuntimeWarningCode {
  return (PER_DOCUMENT_RUNTIME_WARNING_CODES as readonly ExternalKnowledgeRuntimeErrorCode[]).includes(code)
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n')
}

function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex')
}

function documentVersion(
  document: ReturnType<typeof externalKnowledgeDocumentService.getByRemoteObjectIdTx>
): ExternalKnowledgeDocumentVersion | null {
  return document
    ? {
        knowledgeItemId: document.knowledgeItemId,
        contentHash: document.contentHash,
        remoteRevision: document.remoteRevision
      }
    : null
}

function sameDocumentVersion(
  left: ExternalKnowledgeDocumentVersion | null,
  right: ExternalKnowledgeDocumentVersion | null
): boolean {
  return (
    left?.knowledgeItemId === right?.knowledgeItemId &&
    left?.contentHash === right?.contentHash &&
    left?.remoteRevision === right?.remoteRevision
  )
}

function matchesSourceFence(
  source: ExternalKnowledgeSource | null,
  fence: ExternalKnowledgeSourceSyncFence
): source is ExternalKnowledgeSource {
  return (
    source?.id === fence.sourceId &&
    source.baseId === fence.baseId &&
    source.revision === fence.expectedSourceRevision &&
    source.activeJobId === fence.activeJobId
  )
}

function syncMetadata(
  input: Pick<SyncExternalKnowledgeDocumentInput, 'reference' | 'observedAt'>
): ExternalKnowledgeDocumentSyncMetadata {
  return {
    canonicalNodeId: input.reference.descriptor.nodeId,
    parentNodeId: input.reference.descriptor.parentNodeId,
    relativeBreadcrumb: input.reference.descriptor.relativeBreadcrumb,
    title: input.reference.descriptor.title,
    originalUrl: input.reference.descriptor.originalUrl,
    remoteRevision: input.reference.descriptor.remoteRevision,
    lastSeenAt: input.observedAt,
    currentWarning: null
  }
}

function syncWarningMetadata(
  input: Pick<SyncExternalKnowledgeDocumentInput, 'reference' | 'observedAt'>,
  currentWarning: string
): ExternalKnowledgeDocumentWarningMetadata {
  return {
    canonicalNodeId: input.reference.descriptor.nodeId,
    parentNodeId: input.reference.descriptor.parentNodeId,
    relativeBreadcrumb: input.reference.descriptor.relativeBreadcrumb,
    title: input.reference.descriptor.title,
    originalUrl: input.reference.descriptor.originalUrl,
    lastSeenAt: input.observedAt,
    currentWarning
  }
}

function finalizedSummary(summary: ExternalKnowledgeSourceSyncSummary): ExternalKnowledgeSourceSyncSummary {
  return { ...summary, warningCount: summary.warnings.length, warnings: [...summary.warnings] }
}

export class ExternalKnowledgeSyncService {
  private readonly dependencies: ExternalKnowledgeSyncDependencies

  constructor(
    private readonly runtime: ExternalKnowledgeReadRuntime,
    private readonly knowledgeLockManager: KeyedMutex,
    dependencies: Partial<ExternalKnowledgeSyncDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
  }

  async syncSource(input: SyncExternalKnowledgeSourceInput): Promise<ExternalKnowledgeSourceSyncSummary> {
    const summary: ExternalKnowledgeSourceSyncSummary = {
      scannedCount: 0,
      indexedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      warningCount: 0,
      warnings: []
    }
    const db = application.get('DbService').getDb()

    try {
      input.signal.throwIfAborted()
    } catch {
      throw new ExternalKnowledgeSourceSyncError('cancelled', finalizedSummary(summary))
    }
    const source = externalKnowledgeSourceService.getByIdTx(db, input.fence.sourceId)
    if (!matchesSourceFence(source, input.fence)) {
      throw new ExternalKnowledgeSourceSyncError('stale-publication', finalizedSummary(summary))
    }

    let scan: FeishuKnowledgeSourceScanResult
    try {
      scan = await this.runtime.scanFeishuSource(
        source.connectionId,
        { spaceId: source.spaceId, scope: source.scope },
        input.signal
      )
    } catch (error) {
      throw new ExternalKnowledgeSourceSyncError(
        this.runFatalCode(error, input.signal, 'scan-failed'),
        finalizedSummary(summary)
      )
    }
    summary.scannedCount = scan.visibleNodeCount
    summary.skippedCount = scan.unsupportedOrSkippedCount
    const observedAt = this.dependencies.now()

    for (const reference of scan.canonicalReferences) {
      try {
        input.signal.throwIfAborted()
      } catch {
        throw new ExternalKnowledgeSourceSyncError('cancelled', finalizedSummary(summary))
      }

      const expectedDocument = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
        db,
        input.fence.baseId,
        input.fence.sourceId,
        reference.descriptor.remoteObjectId
      )
      let result: ExternalKnowledgeDocumentSyncResult
      try {
        result = await this.syncDocument({ ...input, reference, observedAt })
      } catch (error) {
        const cleanupWarnings = error instanceof ExternalKnowledgeDocumentSyncFailure ? error.cleanupWarnings : []
        const appendCleanupWarnings = () => {
          for (const code of cleanupWarnings) {
            summary.warnings.push({ code, remoteObjectId: reference.descriptor.remoteObjectId })
          }
        }
        if (input.signal.aborted) {
          appendCleanupWarnings()
          throw new ExternalKnowledgeSourceSyncError('cancelled', finalizedSummary(summary))
        }
        if (error instanceof ExternalKnowledgeDocumentReadError) {
          if (error.code === 'resource-permission-denied') {
            let cleanupWarnings: ExternalKnowledgeSourceSyncWarning[]
            try {
              cleanupWarnings = await this.markDocumentUnavailable(
                input,
                reference,
                expectedDocument,
                'resource-permission-denied'
              )
            } catch (reconciliationError) {
              throw new ExternalKnowledgeSourceSyncError(
                this.reconciliationErrorCode(reconciliationError, input.signal),
                finalizedSummary(summary)
              )
            }
            summary.skippedCount += 1
            summary.warnings.push({ code: error.code, remoteObjectId: reference.descriptor.remoteObjectId })
            summary.warnings.push(...cleanupWarnings)
            continue
          }
          if (!isPerDocumentRuntimeWarningCode(error.code)) {
            throw new ExternalKnowledgeSourceSyncError(error.code, finalizedSummary(summary))
          }
          try {
            await this.recordDocumentWarning(input, reference, expectedDocument, observedAt, error.code)
          } catch (reconciliationError) {
            throw new ExternalKnowledgeSourceSyncError(
              this.reconciliationErrorCode(reconciliationError, input.signal),
              finalizedSummary(summary)
            )
          }
          summary.skippedCount += 1
          summary.warnings.push({ code: error.code, remoteObjectId: reference.descriptor.remoteObjectId })
          continue
        }

        try {
          await this.recordDocumentWarning(input, reference, expectedDocument, observedAt, 'document-sync-failed')
        } catch (reconciliationError) {
          appendCleanupWarnings()
          throw new ExternalKnowledgeSourceSyncError(
            this.reconciliationErrorCode(reconciliationError, input.signal),
            finalizedSummary(summary)
          )
        }
        summary.skippedCount += 1
        summary.warnings.push({ code: 'document-sync-failed', remoteObjectId: reference.descriptor.remoteObjectId })
        appendCleanupWarnings()
        continue
      }

      const stale = result.warnings.includes('stale-publication')
      for (const code of result.warnings) {
        if (code !== 'stale-publication') {
          summary.warnings.push({ code, remoteObjectId: reference.descriptor.remoteObjectId })
        }
      }
      if (stale) {
        throw new ExternalKnowledgeSourceSyncError('stale-publication', finalizedSummary(summary))
      }
      if (result.outcome === 'indexed') summary.indexedCount += 1
      else if (result.outcome === 'unchanged') summary.unchangedCount += 1
      else summary.skippedCount += 1
    }

    try {
      summary.warnings.push(
        ...(await this.reconcileMissingDocuments(
          input,
          new Set(scan.canonicalReferences.map((reference) => reference.descriptor.remoteObjectId))
        ))
      )
    } catch (error) {
      throw new ExternalKnowledgeSourceSyncError(
        this.reconciliationErrorCode(error, input.signal),
        finalizedSummary(summary)
      )
    }
    return finalizedSummary(summary)
  }

  async syncDocument(input: SyncExternalKnowledgeDocumentInput): Promise<ExternalKnowledgeDocumentSyncResult> {
    input.signal.throwIfAborted()
    const base = knowledgeBaseService.getById(input.fence.baseId)
    if (!isCompletedKnowledgeBase(base)) {
      throw DataApiErrorFactory.invalidOperation(
        'sync external knowledge document',
        `Knowledge base '${base.id}' is not ready for external synchronization`
      )
    }
    const dbService = application.get('DbService')
    const source = externalKnowledgeSourceService.getByIdTx(dbService.getDb(), input.fence.sourceId)
    if (!matchesSourceFence(source, input.fence)) {
      return { outcome: 'skipped', warnings: ['stale-publication'] }
    }
    const initialDocument = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
      dbService.getDb(),
      input.fence.baseId,
      input.fence.sourceId,
      input.reference.descriptor.remoteObjectId
    )
    const expectedDocument = documentVersion(initialDocument)
    let previousItem: KnowledgeItemOf<'external'> | null = null
    if (initialDocument?.availability === 'active') {
      const ownedItem = knowledgeItemService.getById(initialDocument.knowledgeItemId)
      if (ownedItem.type !== 'external') {
        throw new Error(`External document owner is not an external item: ${ownedItem.id}`)
      }
      previousItem = ownedItem
    }

    if (
      initialDocument?.availability === 'active' &&
      initialDocument.remoteRevision !== null &&
      initialDocument.remoteRevision === input.reference.descriptor.remoteRevision
    ) {
      return await this.updateUnchangedDocument(input, expectedDocument!)
    }

    input.reportProgress(0, { stage: 'reading', currentFile: 0, totalFiles: 1 })
    let read: { content: string }
    try {
      read = await this.runtime.readFeishuDocument(source.connectionId, input.reference, input.signal)
    } catch (error) {
      if (error instanceof ExternalKnowledgeRuntimeError) {
        throw new ExternalKnowledgeDocumentReadError(error.code)
      }
      throw error
    }
    const markdown = normalizeMarkdown(read.content)
    const contentHash = hashMarkdown(markdown)
    if (initialDocument?.availability === 'active' && initialDocument.contentHash === contentHash) {
      return await this.updateUnchangedDocument(input, expectedDocument!)
    }
    const itemId = this.dependencies.createItemId()
    const relativePath = KnowledgeRelativePathSchema.parse(`external/${itemId}.md`)
    const now = new Date(input.observedAt).toISOString()
    const item: KnowledgeItemOf<'external'> = {
      id: itemId,
      baseId: input.fence.baseId,
      groupId: null,
      type: 'external',
      data: { source: source.name, title: input.reference.descriptor.title, relativePath },
      status: 'completed',
      error: null,
      createdAt: now,
      updatedAt: now
    }
    const store = this.dependencies.getIndexStore(base)
    let snapshotStaged = false
    let materialStaged = false

    try {
      await this.dependencies.writeFileIntoKnowledgeBaseAt(input.fence.baseId, relativePath, markdown)
      snapshotStaged = true
      const prepared = await this.dependencies.prepareKnowledgeMaterial({
        base,
        item,
        signal: input.signal,
        reportProgress: input.reportProgress,
        listExistingEmbeddingHashes: isCompletedVectorKnowledgeBase(base)
          ? (hashes) => store.listExistingEmbeddingHashes(hashes)
          : undefined
      })

      input.reportProgress(80, { stage: 'writing', currentFile: 0, totalFiles: 1 })
      const warnings = await this.knowledgeLockManager.runExclusive(input.fence.baseId, async () => {
        input.signal.throwIfAborted()
        const txDb = dbService.getDb()
        const latestSource = externalKnowledgeSourceService.getByIdTx(txDb, input.fence.sourceId)
        const latestDocument = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
          txDb,
          input.fence.baseId,
          input.fence.sourceId,
          input.reference.descriptor.remoteObjectId
        )
        if (
          !matchesSourceFence(latestSource, input.fence) ||
          !sameDocumentVersion(documentVersion(latestDocument), expectedDocument)
        ) {
          throw new StaleExternalKnowledgePublicationError()
        }

        materialStaged = true
        store.rebuildMaterial(itemId, prepared.rebuildInput)
        dbService.withWriteTx((tx) => {
          knowledgeItemService.createCompletedExternalTx(tx, input.fence.baseId, itemId, {
            ...item.data,
            source: latestSource.name
          })
          if (!latestDocument) {
            const document = externalKnowledgeDocumentService.createActiveTx(tx, input.fence, {
              remoteObjectId: input.reference.descriptor.remoteObjectId,
              ...syncMetadata(input),
              contentHash,
              knowledgeItemId: itemId
            })
            if (!document) throw new StaleExternalKnowledgePublicationError()
            return
          }

          const published = externalKnowledgeDocumentService.publishTx(
            tx,
            input.fence,
            latestDocument.id,
            expectedDocument!,
            {
              knowledgeItemId: itemId,
              contentHash,
              remoteRevision: input.reference.descriptor.remoteRevision
            }
          )
          if (!published) throw new StaleExternalKnowledgePublicationError()
          const updated = externalKnowledgeDocumentService.updateSyncMetadataTx(
            tx,
            input.fence,
            latestDocument.id,
            { knowledgeItemId: itemId, contentHash, remoteRevision: input.reference.descriptor.remoteRevision },
            syncMetadata(input)
          )
          if (!updated) throw new StaleExternalKnowledgePublicationError()
          if (
            previousItem &&
            !knowledgeItemService.deleteCompletedExternalTx(tx, input.fence.baseId, previousItem.id)
          ) {
            throw new StaleExternalKnowledgePublicationError()
          }
        })
        return previousItem ? await this.cleanupPublishedOldArtifacts(base, previousItem, store) : []
      })

      return { outcome: 'indexed', warnings }
    } catch (error) {
      const warnings = await this.cleanupStagedArtifacts(base, item, store, materialStaged, snapshotStaged)
      if (error instanceof StaleExternalKnowledgePublicationError) {
        return { outcome: 'skipped', warnings: ['stale-publication', ...warnings] }
      }
      if (warnings.length > 0) {
        throw new ExternalKnowledgeDocumentSyncFailure(warnings)
      }
      throw error
    }
  }

  private async updateUnchangedDocument(
    input: SyncExternalKnowledgeDocumentInput,
    expectedDocument: ExternalKnowledgeDocumentVersion
  ): Promise<ExternalKnowledgeDocumentSyncResult> {
    return await this.knowledgeLockManager.runExclusive(input.fence.baseId, () => {
      input.signal.throwIfAborted()
      const dbService = application.get('DbService')
      const db = dbService.getDb()
      const latestSource = externalKnowledgeSourceService.getByIdTx(db, input.fence.sourceId)
      const latestDocument = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
        db,
        input.fence.baseId,
        input.fence.sourceId,
        input.reference.descriptor.remoteObjectId
      )
      if (
        !matchesSourceFence(latestSource, input.fence) ||
        latestDocument?.availability !== 'active' ||
        !sameDocumentVersion(documentVersion(latestDocument), expectedDocument)
      ) {
        return { outcome: 'skipped', warnings: ['stale-publication'] }
      }

      dbService.withWriteTx((tx) => {
        const item = knowledgeItemService.updateCompletedExternalMetadataTx(tx, latestDocument.knowledgeItemId, {
          baseId: input.fence.baseId,
          source: latestSource.name,
          title: input.reference.descriptor.title
        })
        if (!item) throw new StaleExternalKnowledgePublicationError()
        const document = externalKnowledgeDocumentService.updateSyncMetadataTx(
          tx,
          input.fence,
          latestDocument.id,
          expectedDocument,
          syncMetadata(input)
        )
        if (!document) throw new StaleExternalKnowledgePublicationError()
      })

      return { outcome: 'unchanged', warnings: [] }
    })
  }

  private runFatalCode(
    error: unknown,
    signal: AbortSignal,
    fallback: ExternalKnowledgeSourceSyncErrorCode
  ): ExternalKnowledgeSourceSyncErrorCode {
    if (signal.aborted) return 'cancelled'
    return error instanceof ExternalKnowledgeRuntimeError ? error.code : fallback
  }

  private reconciliationErrorCode(error: unknown, signal: AbortSignal): ExternalKnowledgeSourceSyncErrorCode {
    if (signal.aborted) return 'cancelled'
    if (
      error instanceof StaleExternalKnowledgePublicationError ||
      error instanceof ExternalKnowledgeDocumentOwnershipChangedError
    ) {
      return 'stale-publication'
    }
    return 'reconciliation-failed'
  }

  private async recordDocumentWarning(
    input: SyncExternalKnowledgeSourceInput,
    reference: FeishuKnowledgeReference,
    expectedDocument: ReturnType<typeof externalKnowledgeDocumentService.getByRemoteObjectIdTx>,
    observedAt: number,
    warning: ExternalKnowledgeSourceSyncWarningCode
  ): Promise<void> {
    await this.knowledgeLockManager.runExclusive(input.fence.baseId, () => {
      input.signal.throwIfAborted()
      const dbService = application.get('DbService')
      const db = dbService.getDb()
      const source = externalKnowledgeSourceService.getByIdTx(db, input.fence.sourceId)
      if (!matchesSourceFence(source, input.fence)) throw new StaleExternalKnowledgePublicationError()
      const document = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
        db,
        input.fence.baseId,
        input.fence.sourceId,
        reference.descriptor.remoteObjectId
      )
      if (
        document?.id !== expectedDocument?.id ||
        !sameDocumentVersion(documentVersion(document), documentVersion(expectedDocument))
      ) {
        throw new StaleExternalKnowledgePublicationError()
      }
      if (document?.availability !== 'active') return
      const expected = documentVersion(expectedDocument)!

      dbService.withWriteTx((tx) => {
        const item = knowledgeItemService.updateCompletedExternalMetadataTx(tx, document.knowledgeItemId, {
          baseId: input.fence.baseId,
          source: source.name,
          title: reference.descriptor.title
        })
        if (!item) throw new StaleExternalKnowledgePublicationError()
        const updated = externalKnowledgeDocumentService.updateSyncWarningTx(
          tx,
          input.fence,
          document.id,
          expected,
          syncWarningMetadata({ reference, observedAt }, warning)
        )
        if (!updated) throw new StaleExternalKnowledgePublicationError()
      })
    })
  }

  private async markDocumentUnavailable(
    input: SyncExternalKnowledgeSourceInput,
    reference: FeishuKnowledgeReference,
    expectedDocument: ReturnType<typeof externalKnowledgeDocumentService.getByRemoteObjectIdTx>,
    currentWarning: string
  ): Promise<ExternalKnowledgeSourceSyncWarning[]> {
    const base = knowledgeBaseService.getById(input.fence.baseId)
    if (!isCompletedKnowledgeBase(base)) {
      throw DataApiErrorFactory.invalidOperation(
        'withdraw external knowledge document',
        `Knowledge base '${base.id}' is not ready for external synchronization`
      )
    }

    return await this.knowledgeLockManager.runExclusive(input.fence.baseId, async () => {
      input.signal.throwIfAborted()
      const dbService = application.get('DbService')
      const db = dbService.getDb()
      const source = externalKnowledgeSourceService.getByIdTx(db, input.fence.sourceId)
      if (!matchesSourceFence(source, input.fence)) throw new StaleExternalKnowledgePublicationError()
      const document = externalKnowledgeDocumentService.getByRemoteObjectIdTx(
        db,
        input.fence.baseId,
        input.fence.sourceId,
        reference.descriptor.remoteObjectId
      )
      if (
        document?.id !== expectedDocument?.id ||
        !sameDocumentVersion(documentVersion(document), documentVersion(expectedDocument))
      ) {
        throw new StaleExternalKnowledgePublicationError()
      }
      if (document?.availability !== 'active') return []
      const item = knowledgeItemService.getById(document.knowledgeItemId)
      if (item.type !== 'external') throw new StaleExternalKnowledgePublicationError()

      dbService.withWriteTx((tx) => {
        externalKnowledgeDocumentService.markUnavailableBatchTx(
          tx,
          input.fence,
          [{ documentId: document.id, expected: documentVersion(expectedDocument)! }],
          currentWarning
        )
        if (!knowledgeItemService.deleteCompletedExternalTx(tx, input.fence.baseId, item.id)) {
          throw new StaleExternalKnowledgePublicationError()
        }
      })
      return await this.cleanupUnavailableArtifacts(base, [item], {
        vector: 'permission-vector-cleanup-failed',
        snapshot: 'permission-snapshot-cleanup-failed'
      })
    })
  }

  private async reconcileMissingDocuments(
    input: SyncExternalKnowledgeSourceInput,
    seenRemoteObjectIds: ReadonlySet<string>
  ): Promise<ExternalKnowledgeSourceSyncWarning[]> {
    const base = knowledgeBaseService.getById(input.fence.baseId)
    if (!isCompletedKnowledgeBase(base)) {
      throw DataApiErrorFactory.invalidOperation(
        'reconcile external knowledge documents',
        `Knowledge base '${base.id}' is not ready for external synchronization`
      )
    }

    return await this.knowledgeLockManager.runExclusive(input.fence.baseId, async () => {
      input.signal.throwIfAborted()
      const dbService = application.get('DbService')
      const db = dbService.getDb()
      const source = externalKnowledgeSourceService.getByIdTx(db, input.fence.sourceId)
      if (!matchesSourceFence(source, input.fence)) throw new StaleExternalKnowledgePublicationError()
      const missingDocuments = externalKnowledgeDocumentService
        .listBySourceIdTx(db, input.fence.sourceId)
        .filter((document) => document.availability === 'active' && !seenRemoteObjectIds.has(document.remoteObjectId))
      const items = missingDocuments.map((document) => {
        if (document.availability !== 'active') throw new StaleExternalKnowledgePublicationError()
        const item = knowledgeItemService.getById(document.knowledgeItemId)
        if (item.type !== 'external') throw new StaleExternalKnowledgePublicationError()
        return item
      })

      dbService.withWriteTx((tx) => {
        const currentSource = externalKnowledgeSourceService.getByIdTx(tx, input.fence.sourceId)
        if (!matchesSourceFence(currentSource, input.fence)) throw new StaleExternalKnowledgePublicationError()
        externalKnowledgeDocumentService.markUnavailableBatchTx(
          tx,
          input.fence,
          missingDocuments.map((document) => ({ documentId: document.id, expected: documentVersion(document)! })),
          'source-document-missing'
        )
        for (const item of items) {
          if (!knowledgeItemService.deleteCompletedExternalTx(tx, input.fence.baseId, item.id)) {
            throw new StaleExternalKnowledgePublicationError()
          }
        }
      })

      return await this.cleanupUnavailableArtifacts(base, items, {
        vector: 'missing-vector-cleanup-failed',
        snapshot: 'missing-snapshot-cleanup-failed'
      })
    })
  }

  private async cleanupUnavailableArtifacts(
    base: Parameters<ExternalKnowledgeSyncDependencies['getIndexStore']>[0],
    items: KnowledgeItemOf<'external'>[],
    warningCodes: {
      vector: ExternalKnowledgeSourceSyncWarningCode
      snapshot: ExternalKnowledgeSourceSyncWarningCode
    }
  ): Promise<ExternalKnowledgeSourceSyncWarning[]> {
    if (items.length === 0) return []
    const warnings: ExternalKnowledgeSourceSyncWarning[] = []
    const itemIds = items.map((item) => item.id)
    try {
      const store = this.dependencies.getIndexStore(base)
      await store.deleteMaterials(itemIds)
    } catch {
      warnings.push({ code: warningCodes.vector })
      logger.warn('Failed to clean unavailable external knowledge vector material', {
        baseId: base.id,
        itemCount: itemIds.length,
        code: warningCodes.vector
      })
    }
    try {
      await this.dependencies.deleteKnowledgeItemFiles(base.id, items)
    } catch {
      warnings.push({ code: warningCodes.snapshot })
      logger.warn('Failed to clean unavailable external knowledge snapshots', {
        baseId: base.id,
        itemCount: itemIds.length,
        code: warningCodes.snapshot
      })
    }
    return warnings
  }

  private async cleanupStagedArtifacts(
    base: Parameters<ExternalKnowledgeSyncDependencies['getIndexStore']>[0],
    item: KnowledgeItemOf<'external'>,
    store: ExternalKnowledgeIndexStore,
    materialStaged: boolean,
    snapshotStaged: boolean
  ): Promise<ExternalKnowledgeArtifactCleanupWarning[]> {
    const warnings: ExternalKnowledgeArtifactCleanupWarning[] = []
    if (materialStaged) {
      try {
        await this.knowledgeLockManager.runExclusive(base.id, () => store.deleteMaterials([item.id]))
      } catch {
        warnings.push('staged-vector-cleanup-failed')
        logger.warn('Failed to clean staged external knowledge vector material', {
          baseId: base.id,
          itemId: item.id,
          code: 'staged-vector-cleanup-failed'
        })
      }
    }
    if (snapshotStaged) {
      try {
        await this.dependencies.deleteKnowledgeItemFiles(base.id, [item])
      } catch {
        warnings.push('staged-snapshot-cleanup-failed')
        logger.warn('Failed to clean staged external knowledge snapshot', {
          baseId: base.id,
          itemId: item.id,
          code: 'staged-snapshot-cleanup-failed'
        })
      }
    }
    return warnings
  }

  private async cleanupPublishedOldArtifacts(
    base: Parameters<ExternalKnowledgeSyncDependencies['getIndexStore']>[0],
    item: KnowledgeItemOf<'external'>,
    store: ExternalKnowledgeIndexStore
  ): Promise<ExternalKnowledgeArtifactCleanupWarning[]> {
    const warnings: ExternalKnowledgeArtifactCleanupWarning[] = []
    try {
      await store.deleteMaterials([item.id])
    } catch {
      warnings.push('old-vector-cleanup-failed')
      logger.warn('Failed to clean replaced external knowledge vector material', {
        baseId: base.id,
        itemId: item.id,
        code: 'old-vector-cleanup-failed'
      })
    }
    try {
      await this.dependencies.deleteKnowledgeItemFiles(base.id, [item])
    } catch {
      warnings.push('old-snapshot-cleanup-failed')
      logger.warn('Failed to clean replaced external knowledge snapshot', {
        baseId: base.id,
        itemId: item.id,
        code: 'old-snapshot-cleanup-failed'
      })
    }
    return warnings
  }
}
