import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'

import { eq } from 'drizzle-orm'
import { v5 as uuid } from 'uuid'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { allocateDurableBackendTx } from '@main/ai/runtime/piDurable/durableContext'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { agentImportSnapshotSchema, type AgentImportSnapshot } from '@shared/ai/agentImport'

import { createDurableBackend, reconcileDurableBackend } from '../durableNativeContext'
import { deepseekFiles, type DeepseekConversation } from './deepseek'
import { deepseekArchiveDigest, openDeepseekArchive } from './deepseekArchive'
import { deepseekContent } from './deepseekContent'
import { importDurableHistory } from './durableImport'

const operationSchema = agentImportSnapshotSchema.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
const receiptSchema = z.object({
  sessionId: z.uuid(),
  backendId: z.uuid(),
  published: z.boolean(),
  files: z.record(z.string(), z.string())
})
type Operation = z.infer<typeof operationSchema>
const logger = loggerService.withContext('AgentImportService')
const namespace = 'd1ba1619-07e0-4f3b-a76a-c26beefeaef0'

function readState(key: string): unknown {
  return application.get('DbService').getDb().select().from(appStateTable).where(eq(appStateTable.key, key)).get()
    ?.value
}
function writeState(tx: DbOrTx, key: string, value: unknown) {
  tx.insert(appStateTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: appStateTable.key, set: { value, updatedAt: Date.now() } })
    .run()
}

@Injectable('AgentImportService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager'])
export class AgentImportService extends BaseService {
  private readonly runs = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private stopping = false
  private readonly pauseHolds = new Set<symbol>()
  private readonly preparations = new Map<Promise<AgentImportSnapshot>, string>()

  protected onInit(): void {
    this.stopping = false
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    for (const run of this.runs.values()) run.controller.abort()
    await Promise.allSettled([...this.preparations.keys(), ...[...this.runs.values()].map((run) => run.done)])
  }

  private assertAgent(agentId: string) {
    const agent = agentService.getAgent(agentId)
    if (!agent || agent.type !== 'pi-durable') throw new Error('DeepSeek import requires a Pi Durable Agent')
    return agent
  }
  private archivePath(digest: string) {
    return application.getPath('feature.agents.imports', `${digest}.zip`)
  }
  private operation(id: string) {
    return operationSchema.parse(readState(`agent-import:operation:${id}`))
  }
  private save(operation: Operation) {
    operation.revision++
    application.get('DbService').withWriteTx((tx) => {
      writeState(tx, `agent-import:operation:${operation.id}`, operation)
      writeState(tx, `agent-import:latest:${operation.agentId}`, operation.id)
    })
    try {
      application.get('IpcApiService').broadcast('ai.agent.import.progress', agentImportSnapshotSchema.parse(operation))
    } catch (error) {
      logger.warn('Import progress notification failed', { error })
    }
  }
  status(agentId: string): AgentImportSnapshot | null {
    const id = readState(`agent-import:latest:${agentId}`)
    if (typeof id !== 'string') return null
    const operation = this.operation(id)
    if (operation.status === 'running' && !this.runs.has(id)) operation.status = 'interrupted'
    return agentImportSnapshotSchema.parse(operation)
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason)
    this.pauseHolds.add(token)
    return {
      dispose: () => {
        this.pauseHolds.delete(token)
      }
    }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [...this.preparations.values(), ...this.runs.keys()].map((id) => ({ id, summary: 'DeepSeek Agent import' }))
  }

  async drainInFlight({ timeoutMs }: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled([...this.preparations.keys(), ...[...this.runs.values()].map((run) => run.done)]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
    return { stragglerIds: this.listActiveWork().map(({ id }) => id) }
  }

  prepare(agentId: string, file: string): Promise<AgentImportSnapshot> {
    if (this.stopping || this.pauseHolds.size) return Promise.reject(new Error('Agent imports are paused'))
    if ([...this.preparations.values()].includes(agentId))
      return Promise.reject(new Error('An import preview is already running'))
    const work = this.prepareArchive(agentId, file)
    this.preparations.set(work, agentId)
    void work.finally(() => this.preparations.delete(work)).catch(() => {})
    return work
  }

  private async prepareArchive(agentId: string, file: string): Promise<AgentImportSnapshot> {
    this.assertAgent(agentId)
    if (this.stopping || [...this.runs.keys()].some((id) => this.operation(id).agentId === agentId))
      throw new Error('An import is already running')
    await mkdir(application.getPath('feature.agents.imports'), { recursive: true })
    const temporary = application.getPath('feature.agents.imports', `${randomUUID()}.tmp`)
    try {
      await deepseekArchiveDigest(file)
      await copyFile(file, temporary)
      const digest = await deepseekArchiveDigest(temporary)
      const archive = await openDeepseekArchive(temporary)
      let count = 0
      const missingFiles: string[] = []
      try {
        for (const item of archive.index) {
          const source = await archive.load(item.id)
          count += source.messages.length
          if (count > 100_000) throw new Error('DeepSeek archive has too many messages')
          for (const attachment of deepseekFiles(source))
            if (attachment.export_path === null) missingFiles.push(attachment.file_name)
        }
      } finally {
        await archive.close()
      }
      const id = uuid(`${agentId}:${digest}`, namespace)
      const previous = readState(`agent-import:operation:${id}`)
      const operation: Operation = previous
        ? operationSchema.parse(previous)
        : {
            id,
            revision: 0,
            agentId,
            digest,
            status: 'ready',
            conversations: archive.index.length,
            messages: count,
            imported: 0,
            skipped: 0,
            failed: 0,
            remaining: archive.index.length,
            missingFiles,
            sessionIds: []
          }
      await rename(temporary, this.archivePath(digest))
      application.get('DbService').withWriteTx((tx) => {
        writeState(tx, `agent-import:operation:${id}`, operation)
        writeState(tx, `agent-import:latest:${agentId}`, id)
      })
      return this.status(agentId)!
    } finally {
      await rm(temporary, { force: true })
    }
  }

  start(id: string): AgentImportSnapshot {
    const operation = this.operation(id)
    this.assertAgent(operation.agentId)
    if (this.stopping || this.pauseHolds.size) throw new Error('Agent imports are paused')
    if (this.runs.has(id)) return agentImportSnapshotSchema.parse(operation)
    if ([...this.preparations.values()].includes(operation.agentId))
      throw new Error('An import preview is already running')
    if ([...this.runs.keys()].some((other) => this.operation(other).agentId === operation.agentId))
      throw new Error('An import is already running')
    const controller = new AbortController()
    Object.assign(operation, {
      status: 'running',
      imported: 0,
      skipped: 0,
      failed: 0,
      remaining: operation.conversations,
      sessionIds: [],
      error: undefined
    })
    this.save(operation)
    const done = this.run(operation, controller.signal)
      .catch((error) => {
        logger.error('Failed to persist import progress', error)
      })
      .finally(() => this.runs.delete(id))
    this.runs.set(id, { controller, done })
    return agentImportSnapshotSchema.parse(operation)
  }
  cancel(id: string): void {
    this.runs.get(id)?.controller.abort()
  }

  private async run(operation: Operation, signal: AbortSignal): Promise<void> {
    try {
      const file = this.archivePath(operation.digest)
      if ((await deepseekArchiveDigest(file)) !== operation.digest) throw new Error('DeepSeek archive changed')
      const archive = await openDeepseekArchive(file)
      try {
        for (const item of archive.index) {
          signal.throwIfAborted()
          this.assertAgent(operation.agentId)
          const result = await this.importConversation(operation, await archive.load(item.id), archive.read, signal)
          operation[result.published ? 'skipped' : 'imported']++
          operation.remaining--
          operation.sessionIds.push(result.sessionId)
          this.save(operation)
        }
      } finally {
        await archive.close()
      }
      operation.status = 'completed'
    } catch (error) {
      operation.status = signal.aborted ? 'cancelled' : 'failed'
      if (!signal.aborted) {
        operation.failed = operation.remaining > 0 ? 1 : 0
        operation.remaining -= operation.failed
        operation.error = error instanceof Error ? error.message : String(error)
      }
    }
    this.save(operation)
  }

  private async importConversation(
    operation: Operation,
    source: DeepseekConversation,
    read: (name: string) => Promise<Buffer>,
    signal: AbortSignal
  ) {
    const key = `agent-import:conversation:${operation.id}:${source.id}`
    const receipt = application.get('DbService').withWriteTx((tx) => {
      const saved = tx.select().from(appStateTable).where(eq(appStateTable.key, key)).get()?.value
      if (saved) return receiptSchema.parse(saved)
      const value = {
        sessionId: randomUUID(),
        backendId: allocateDurableBackendTx(tx).id,
        published: false,
        files: {} as Record<string, string>
      }
      writeState(tx, key, value)
      return value
    })
    if (receipt.published) return receipt
    const content = new Map<string, Awaited<ReturnType<typeof deepseekContent>>>()
    const productId = (id: number) => uuid(String(id), receipt.sessionId)
    for (const message of source.messages) {
      signal.throwIfAborted()
      content.set(
        productId(message.id),
        await deepseekContent(message, read, receipt.files, (sourceId, entryId) => {
          Object.defineProperty(receipt.files, sourceId, {
            value: entryId,
            enumerable: true,
            configurable: true,
            writable: true
          })
          application.get('DbService').withWriteTx((tx) => writeState(tx, key, receipt))
        })
      )
    }
    if (contexts.backend(receipt.backendId).state === 'creating') {
      try {
        await createDurableBackend(receipt.backendId)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    const { createSession } = await import('@earendil-works/pi-durable')
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
    const native = createSession(await reconcileDurableBackend(receipt.backendId))
    let nodes: Awaited<ReturnType<typeof importDurableHistory>>
    try {
      nodes = await importDurableHistory(
        native,
        receipt.sessionId,
        source.messages.map((message) => ({
          id: productId(message.id),
          parentId: message.parent_id === null ? null : productId(message.parent_id),
          model: content.get(productId(message.id))!.model
        })),
        signal
      )
    } finally {
      await native.close(BACKGROUND_CONTEXT)
    }
    signal.throwIfAborted()
    const agent = this.assertAgent(operation.agentId)
    application.get('DbService').withWriteTx((tx) => {
      agentSessionService.createTx(
        tx,
        receipt.sessionId,
        { agentId: agent.id, name: source.title || 'DeepSeek', workspace: { type: 'system' } },
        'conversation',
        Date.parse(source.inserted_at)
      )
      const rows = source.messages.map((message) => {
        const id = productId(message.id)
        const node = nodes[id]
        const checkpoint = {
          runtime: 'pi-durable' as const,
          backendId: receipt.backendId,
          conversationId: node.conversationId,
          entryId: node.entryId
        }
        return {
          id,
          parentId: message.parent_id === null ? null : productId(message.parent_id),
          role: message.role === 'USER' ? 'user' : 'assistant',
          status: message.status === 'FINISHED' ? 'success' : 'error',
          data: {
            parts: content.get(id)!.parts,
            importedHistory: {
              source: 'deepseek' as const,
              messageId: String(message.id),
              status: message.status,
              missingFiles: message.fragments.flatMap((part) =>
                part.type === 'FILE'
                  ? part.files
                      .filter((file) => file.export_path === null)
                      .map((file) => ({
                        id: file.id,
                        name: file.file_name,
                        size: file.file_size,
                        isImage: file.is_image
                      }))
                  : []
              )
            },
            ...(message.role === 'ASSISTANT' &&
              message.status === 'FINISHED' && { runtimeAnchor: { checkpoint, excludedMessageIds: [] } })
          },
          messageSnapshot:
            message.role === 'ASSISTANT'
              ? {
                  id: agent.id,
                  name: 'DeepSeek',
                  emoji: '🐋',
                  model: { id: 'imported-history', name: 'DeepSeek', provider: 'deepseek' }
                }
              : null,
          runtimeResumeToken: node.conversationId,
          createdAt: Date.parse(message.inserted_at),
          updatedAt: Date.parse(message.inserted_at)
        }
      })
      agentSessionMessageService.insertImportedMessagesTx(
        tx,
        receipt.sessionId,
        rows,
        source.current_message_id === null ? null : productId(source.current_message_id)
      )
      for (const row of rows) {
        const node = nodes[row.id]
        contexts.reserveBranchTx(tx, {
          id: node.contextId,
          sessionId: receipt.sessionId,
          backendId: receipt.backendId,
          anchorMessageId: row.id,
          nativeThreadId: node.conversationId,
          checkpointMapping: { fork: {} }
        })
      }
      agentSessionService.finishHistoryImportTx(tx, receipt.sessionId, Date.parse(source.updated_at))
      writeState(tx, key, { ...receipt, published: true })
    })
    try {
      agentSessionService.notifyReadModelChange([receipt.sessionId], 'membership')
    } catch (error) {
      logger.warn('Imported session notification failed', { error })
    }
    return receipt
  }
}
