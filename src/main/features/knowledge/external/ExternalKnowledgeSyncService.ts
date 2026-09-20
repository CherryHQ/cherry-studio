import { createHash } from 'node:crypto'

import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import {
  type ExternalKnowledgeDocumentSyncMetadata,
  type ExternalKnowledgeDocumentVersion,
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
import type { FeishuKnowledgeReference } from './feishuKnowledgeReadAdapter'

const logger = loggerService.withContext('Knowledge:ExternalKnowledgeSync')

type ExternalKnowledgeIndexStore = {
  listExistingEmbeddingHashes(hashes: string[]): Set<string>
  rebuildMaterial(itemId: string, input: RebuildMaterialInput): void
  deleteMaterials(itemIds: string[]): Promise<void>
}

export type ExternalKnowledgeSyncDependencies = {
  createItemId(): string
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

export type ExternalKnowledgeSyncWarning =
  | 'stale-publication'
  | 'staged-vector-cleanup-failed'
  | 'staged-snapshot-cleanup-failed'
  | 'old-vector-cleanup-failed'
  | 'old-snapshot-cleanup-failed'

export type ExternalKnowledgeDocumentSyncResult = {
  outcome: 'indexed' | 'unchanged' | 'skipped'
  warnings: ExternalKnowledgeSyncWarning[]
}

type ExternalKnowledgeReadRuntime = {
  readFeishuDocument(
    connectionId: string,
    reference: FeishuKnowledgeReference,
    signal?: AbortSignal
  ): Promise<{ content: string }>
}

class StaleExternalKnowledgePublicationError extends Error {}

const defaultDependencies: ExternalKnowledgeSyncDependencies = {
  createItemId: uuidv7,
  writeFileIntoKnowledgeBaseAt,
  deleteKnowledgeItemFiles,
  prepareKnowledgeMaterial,
  getIndexStore: (base) => application.get('KnowledgeVectorStoreService').getIndexStore(base)
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

export class ExternalKnowledgeSyncService {
  private readonly dependencies: ExternalKnowledgeSyncDependencies

  constructor(
    private readonly runtime: ExternalKnowledgeReadRuntime,
    private readonly knowledgeLockManager: KeyedMutex,
    dependencies: Partial<ExternalKnowledgeSyncDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
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
    const read = await this.runtime.readFeishuDocument(source.connectionId, input.reference, input.signal)
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

  private async cleanupStagedArtifacts(
    base: Parameters<ExternalKnowledgeSyncDependencies['getIndexStore']>[0],
    item: KnowledgeItemOf<'external'>,
    store: ExternalKnowledgeIndexStore,
    materialStaged: boolean,
    snapshotStaged: boolean
  ): Promise<ExternalKnowledgeSyncWarning[]> {
    const warnings: ExternalKnowledgeSyncWarning[] = []
    if (materialStaged) {
      try {
        await this.knowledgeLockManager.runExclusive(base.id, () => store.deleteMaterials([item.id]))
      } catch (error) {
        warnings.push('staged-vector-cleanup-failed')
        logger.warn('Failed to clean staged external knowledge vector material', error as Error, {
          baseId: base.id,
          itemId: item.id
        })
      }
    }
    if (snapshotStaged) {
      try {
        await this.dependencies.deleteKnowledgeItemFiles(base.id, [item])
      } catch (error) {
        warnings.push('staged-snapshot-cleanup-failed')
        logger.warn('Failed to clean staged external knowledge snapshot', error as Error, {
          baseId: base.id,
          itemId: item.id
        })
      }
    }
    return warnings
  }

  private async cleanupPublishedOldArtifacts(
    base: Parameters<ExternalKnowledgeSyncDependencies['getIndexStore']>[0],
    item: KnowledgeItemOf<'external'>,
    store: ExternalKnowledgeIndexStore
  ): Promise<ExternalKnowledgeSyncWarning[]> {
    const warnings: ExternalKnowledgeSyncWarning[] = []
    try {
      await store.deleteMaterials([item.id])
    } catch (error) {
      warnings.push('old-vector-cleanup-failed')
      logger.warn('Failed to clean replaced external knowledge vector material', error as Error, {
        baseId: base.id,
        itemId: item.id
      })
    }
    try {
      await this.dependencies.deleteKnowledgeItemFiles(base.id, [item])
    } catch (error) {
      warnings.push('old-snapshot-cleanup-failed')
      logger.warn('Failed to clean replaced external knowledge snapshot', error as Error, {
        baseId: base.id,
        itemId: item.id
      })
    }
    return warnings
  }
}
