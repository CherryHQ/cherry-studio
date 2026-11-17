import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { v5 as uuid } from 'uuid'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { agentImportSnapshotSchema, type AgentImportSnapshot } from '@shared/ai/agentImport'

import { getConversationImporter } from './importers'
import type { ConversationImporter, ImportArchive } from './types'

const operationSchema = agentImportSnapshotSchema.extend({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  importerId: z.string().optional(),
  sourceFile: z.string().optional()
})
const receiptSchema = z.object({
  sessionId: z.uuid(),
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
    if (!agent) throw new Error('Import requires an existing Agent')
    return agent
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
    return [...this.preparations.values(), ...this.runs.keys()].map((id) => ({ id, summary: 'Agent history import' }))
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

  prepare(agentId: string, file: string, importerId?: string): Promise<AgentImportSnapshot> {
    if (this.stopping || this.pauseHolds.size) return Promise.reject(new Error('Agent imports are paused'))
    if ([...this.preparations.values()].includes(agentId))
      return Promise.reject(new Error('An import preview is already running'))
    const work = this.prepareArchive(agentId, file, getConversationImporter(importerId))
    this.preparations.set(work, agentId)
    void work.finally(() => this.preparations.delete(work)).catch(() => {})
    return work
  }

  private async prepareArchive(
    agentId: string,
    file: string,
    importer: ConversationImporter
  ): Promise<AgentImportSnapshot> {
    this.assertAgent(agentId)
    if (this.stopping || [...this.runs.keys()].some((id) => this.operation(id).agentId === agentId))
      throw new Error('An import is already running')
    const digest = await importer.digest(file)
    const archive = await importer.open(file)
    let preview: Awaited<ReturnType<ImportArchive['preview']>>
    try {
      preview = await archive.preview()
    } finally {
      await archive.close()
    }
    const id = uuid(`${agentId}:${digest}`, namespace)
    const previous = readState(`agent-import:operation:${id}`)
    const operation: Operation = previous
      ? { ...operationSchema.parse(previous), importerId: importer.id, sourceFile: file }
      : {
          id,
          revision: 0,
          agentId,
          digest,
          importerId: importer.id,
          sourceFile: file,
          status: 'ready',
          conversations: archive.sourceIds.length,
          messages: preview.messages,
          imported: 0,
          skipped: 0,
          failed: 0,
          remaining: archive.sourceIds.length,
          missingFiles: preview.missingFiles,
          sessionIds: []
        }
    application.get('DbService').withWriteTx((tx) => {
      writeState(tx, `agent-import:operation:${id}`, operation)
      writeState(tx, `agent-import:latest:${agentId}`, id)
    })
    return this.status(agentId)!
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
      const file = z.string().parse(operation.sourceFile)
      const importer = getConversationImporter(operation.importerId)
      if ((await importer.digest(file)) !== operation.digest) throw new Error('Import file changed')
      const archive = await importer.open(file)
      try {
        for (const sourceId of archive.sourceIds) {
          signal.throwIfAborted()
          this.assertAgent(operation.agentId)
          const result = await this.importConversation({ operation, importer, archive, sourceId, signal })
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

  private async importConversation({
    operation,
    importer,
    archive,
    sourceId,
    signal
  }: {
    operation: Operation
    importer: ConversationImporter
    archive: ImportArchive
    sourceId: string
    signal: AbortSignal
  }) {
    const key = `agent-import:conversation:${operation.id}:${sourceId}`
    const receipt = application.get('DbService').withWriteTx((tx) => {
      const saved = tx.select().from(appStateTable).where(eq(appStateTable.key, key)).get()?.value
      if (saved) return receiptSchema.parse(saved)
      const value = {
        sessionId: randomUUID(),
        published: false,
        files: {} as Record<string, string>
      }
      writeState(tx, key, value)
      return value
    })
    if (receipt.published) return receipt
    const source = await archive.load(sourceId, {
      signal,
      files: receipt.files,
      saveFile: (id, entryId) => {
        Object.defineProperty(receipt.files, id, {
          value: entryId,
          enumerable: true,
          configurable: true,
          writable: true
        })
        application.get('DbService').withWriteTx((tx) => writeState(tx, key, receipt))
      }
    })
    const productId = (id: string) => uuid(id, receipt.sessionId)
    signal.throwIfAborted()
    const agent = this.assertAgent(operation.agentId)
    application.get('DbService').withWriteTx((tx) => {
      agentSessionService.createTx(
        tx,
        receipt.sessionId,
        { agentId: agent.id, name: source.name, workspace: { type: 'system' } },
        'conversation',
        source.createdAt
      )
      const orderedTimes = new Map<string, number>()
      const rows = source.messages.map((message) => {
        const id = productId(message.sourceId)
        const parentTime = message.parentSourceId === null ? undefined : orderedTimes.get(message.parentSourceId)
        const sourceTime = message.createdAt
        const createdAt = parentTime === undefined ? sourceTime : Math.max(sourceTime, parentTime + 1)
        orderedTimes.set(message.sourceId, createdAt)
        return {
          id,
          parentId: message.parentSourceId === null ? null : productId(message.parentSourceId),
          role: message.role,
          status: message.status,
          data: message.data,
          messageSnapshot:
            message.role === 'assistant' && message.model
              ? {
                  id: agent.id,
                  name: importer.name,
                  emoji: importer.emoji,
                  model: message.model
                }
              : null,
          runtimeResumeToken: null,
          createdAt,
          updatedAt: createdAt
        }
      })
      agentSessionMessageService.insertImportedMessagesTx(
        tx,
        receipt.sessionId,
        rows,
        source.activeSourceId === null ? null : productId(source.activeSourceId)
      )
      agentSessionService.finishHistoryImportTx(tx, receipt.sessionId, source.updatedAt)
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
