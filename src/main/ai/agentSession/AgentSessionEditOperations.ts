import { randomUUID } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import type { DbOrTx } from '@data/db/types'
import { AgentSessionEditError, type AgentSessionEditOperation } from '@data/services/agentSessionEdit'
import { agentSessionEditService } from '@data/services/AgentSessionEditService'
import { agentSessionForkContextService } from '@data/services/AgentSessionForkContextService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { forkContextHash } from '@data/services/utils/forkContext'
import { loggerService } from '@logger'
import type { AgentSessionEditTarget } from '@shared/ai/agentSessionEdit'
import type { CherryMessagePart } from '@shared/data/types/message'
import { getKnowledgeBaseIdsFromParts, readCherryMeta } from '@shared/data/types/uiParts'

import { RuntimeForkStateSchema } from '../runtime/forkCheckpoint'
import type { AgentRuntimeConnectInput, AgentRuntimeConnection } from '../runtime/types'
import { skillService } from '../skills/SkillService'
import type { PersistedAgentDispatch, PreparedDispatch, ValidatedAgentDispatch } from '../streamManager'
import { resolveForkContextInput } from './forkContextEnvironment'
import { forkFileIdentity, publishForkArtifact } from './forkFiles'
import { prepareForkContextDocument } from './prepareForkContext'
import { prepareRuntimeHistory } from './prepareRuntimeHistory'

const logger = loggerService.withContext('AgentSessionEditOperations')

interface EditHost {
  assertIdleForEdit(sessionId: string, ignoreOwnEdit?: boolean): void
  closeForEdit(sessionId: string): Promise<void>
  adoptEditConnection(sessionId: string, connection: AgentRuntimeConnection): void
  connectForEdit(input: AgentRuntimeConnectInput, runtime: string): Promise<AgentRuntimeConnection>
}

export async function validateEditedInput(parts: CherryMessagePart[], validateFiles = true): Promise<void> {
  if (!parts.length) throw new AgentSessionEditError('input_unsupported')
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      if (readCherryMeta(part)?.composer?.tokens.some((token) => token.kind === 'command'))
        throw new AgentSessionEditError('input_unsupported')
      continue
    }
    if (part.type === 'data-knowledge-scope') continue
    if (part.type !== 'file' || !part.url) throw new AgentSessionEditError('input_unsupported')
    if (!validateFiles) continue
    try {
      const id = readCherryMeta(part)?.fileEntryId
      if (id) await application.get('FileManager').readChunk(id, 0, 1)
      else {
        if (!part.url.startsWith('file://')) throw new Error('Attachment has no readable local reference')
        const file = await open(fileURLToPath(part.url), 'r')
        try {
          if (!(await file.stat()).isFile()) throw new Error('Attachment is not a file')
        } finally {
          await file.close()
        }
      }
    } catch {
      throw new AgentSessionEditError('attachment_unavailable')
    }
  }
}

async function validateEditedReferences(validated: ValidatedAgentDispatch): Promise<void> {
  await validateEditedInput(validated.userMessageParts)
  const skillIds = validated.userMessageParts.flatMap((part) =>
    part.type === 'text'
      ? (readCherryMeta(part)?.composer?.tokens ?? [])
          .filter((token) => token.kind === 'skill')
          .map((token) => token.id)
      : []
  )
  if (!skillIds.length) return
  const cwd = agentSessionService.getById(validated.sessionId).workspace.path
  const [installed, local] = await Promise.all([
    skillService.list({ agentId: validated.agentId }),
    skillService.listLocal(cwd)
  ])
  for (const id of new Set(skillIds)) {
    if (local.some((skill) => id === `skill:${skill.filename}`)) continue
    const skill = installed.find((entry) => id === `skill:${entry.folderName}` && entry.isEnabled)
    if (!skill || !(await skillService.readFile(skill.id, 'SKILL.md')))
      throw new AgentSessionEditError('input_unsupported')
  }
}

/** Owns independent native generations, never application sessions or workspaces. */
export class AgentSessionEditOperations {
  readonly pending = new Map<string, { controller: AbortController; promise: Promise<PreparedDispatch> }>()

  constructor(private readonly host: EditHost) {}

  run(
    target: AgentSessionEditTarget,
    validated: ValidatedAgentDispatch,
    persist: (tx: DbOrTx) => PersistedAgentDispatch,
    activate: (persisted: PersistedAgentDispatch) => PreparedDispatch
  ): Promise<PreparedDispatch> {
    const { sessionId } = validated
    if (this.pending.has(sessionId)) return Promise.reject(new AgentSessionEditError('busy'))
    this.host.assertIdleForEdit(sessionId)
    const controller = new AbortController()
    const promise = Promise.resolve()
      .then(() => this.prepare(target, validated, persist, controller.signal))
      .then(async (result) => {
        this.pending.delete(sessionId)
        if (result.sent)
          return {
            topicId: validated.topicId,
            models: [],
            listeners: [],
            reservedMessages: result.persisted.savedMessages.map((row) => ({
              id: row.id,
              role: row.role,
              parts: row.data.parts ?? [],
              metadata: { status: row.status }
            }))
          }
        try {
          const dispatch = activate(result.persisted)
          if (result.connection) this.host.adoptEditConnection(sessionId, result.connection)
          return dispatch
        } catch (error) {
          await result.connection?.close()
          throw error
        }
      })
      .finally(() => this.pending.delete(sessionId))
    this.pending.set(sessionId, { controller, promise })
    return promise
  }

  async cancel(sessionId?: string): Promise<void> {
    const pending = [...this.pending.entries()].filter(([id]) => !sessionId || id === sessionId)
    pending.forEach(([, value]) => value.controller.abort())
    await Promise.allSettled(pending.map(([, value]) => value.promise))
  }

  private async prepare(
    target: AgentSessionEditTarget,
    validated: ValidatedAgentDispatch,
    persist: (tx: DbOrTx) => PersistedAgentDispatch,
    signal: AbortSignal
  ): Promise<{ persisted: PersistedAgentDispatch; sent?: boolean; connection?: AgentRuntimeConnection }> {
    const { sessionId } = validated
    const inputHash = forkContextHash({
      sessionId,
      target,
      parts: validated.userMessageParts,
      model: validated.uniqueModelId,
      reasoning: validated.reasoningEffort,
      tier: validated.serviceTier,
      fast: validated.fastMode
    })
    const previous = agentSessionEditService.get(target.operationId)
    if (previous && previous.inputHash !== inputHash) throw new AgentSessionEditError('operation_conflict')
    if (previous?.executionUncertain) throw new AgentSessionEditError('close_failed')
    if (previous?.committedAt) {
      const current = agentSessionEditService.current(sessionId)
      if (current?.operationId !== previous.operationId) throw new AgentSessionEditError('operation_conflict')
      agentSessionEditService.reconcile(previous)
      if (previous.status === 'sending') throw new AgentSessionEditError('send_uncertain')
      const userMessage = agentSessionMessageService.getSessionMessage(sessionId, previous.userMessageId!)
      let assistant = agentSessionMessageService.getSessionMessage(sessionId, previous.assistantMessageId!)
      validated.userMessageId = userMessage.id
      validated.shouldAutoNameInitialTurn = false
      let connection: AgentRuntimeConnection | undefined
      if (previous.status !== 'sent') {
        if (forkContextHash(userMessage.data.parts) !== forkContextHash(validated.userMessageParts))
          throw new AgentSessionEditError('history_changed')
        agentSessionEditService.save({ ...previous, status: 'preparing' })
        try {
          await validateEditedReferences(validated)
          await this.host.closeForEdit(sessionId)
          signal.throwIfAborted()
          // A committed receipt proves no prompt was sent; initialization tokens do not resume context.
          if (!previous.resumeToken) previous.nativeSessionId = randomUUID()
          connection = await this.host.connectForEdit(
            {
              sessionId,
              agentId: validated.agentId,
              modelId: validated.uniqueModelId,
              reasoningEffort: validated.reasoningEffort,
              serviceTier: validated.serviceTier,
              knowledgeBaseIds: getKnowledgeBaseIdsFromParts(validated.userMessageParts) ?? [],
              fastMode: validated.fastMode,
              nativeSessionId: previous.nativeSessionId,
              resumeToken: previous.resumeToken,
              requireExistingHistory: !!previous.resumeToken
            },
            validated.agentType
          )
          signal.throwIfAborted()
          agentSessionEditService.resetUnsent(previous)
          assistant = agentSessionMessageService.getSessionMessage(sessionId, previous.assistantMessageId!)
        } catch (error) {
          try {
            await connection?.close()
          } catch {
            const owned = agentSessionEditService.get(previous.operationId)!
            agentSessionEditService.save({ ...owned, executionUncertain: true })
          }
          throw error
        } finally {
          const owned = agentSessionEditService.get(previous.operationId)!
          if (owned.status === 'preparing') agentSessionEditService.save({ ...owned, status: 'committed' })
        }
      }
      return {
        connection,
        sent: previous.status === 'sent',
        persisted: {
          validated,
          assistantMessageId: assistant.id,
          userMessage,
          savedMessages: [userMessage, assistant],
          traceId: agentSessionService.ensureTraceId(sessionId)
        }
      }
    }
    const db = application.get('DbService')
    const snapshot = db.withWriteTx((tx) =>
      agentSessionMessageService.readEditSnapshotTx(tx, sessionId, target.messageId)
    )
    if (snapshot.version !== target.version) throw new AgentSessionEditError('history_changed')
    await validateEditedReferences(validated)
    signal.throwIfAborted()
    if (previous && !previous.cleanupComplete) await this.cleanup(previous)
    const session = agentSessionService.getById(sessionId)
    const directory = path.join(application.getPath('feature.agents.forks'), `edit-${randomUUID()}`)
    const operation: AgentSessionEditOperation = {
      version: 1,
      operationId: target.operationId,
      sessionId,
      messageId: target.messageId,
      snapshotVersion: target.version,
      inputHash,
      runtime: validated.agentType,
      nativeSessionId: randomUUID(),
      rebuilt: true,
      status: 'preparing',
      artifactDirectory: directory,
      published: [],
      createdAt: Date.now()
    }
    agentSessionEditService.save(operation)
    let connection: AgentRuntimeConnection | undefined
    let safeToClean = true
    try {
      await mkdir(path.dirname(directory), { recursive: true })
      await mkdir(directory)
      operation.artifactIdentity = await forkFileIdentity(directory)
      agentSessionEditService.save(operation)
      const native = await prepareRuntimeHistory({
        sourceSessionId: sessionId,
        runtime: validated.agentType,
        messages: snapshot.prefix,
        targetSessionId: operation.nativeSessionId,
        targetCwd: session.workspace.path,
        artifactDirectory: directory,
        allowHistoryRebuild: true,
        signal
      })
      operation.resumeToken = native?.resumeToken
      operation.rebuilt = !native && snapshot.prefix.length > 0
      for (const artifact of native?.publish ?? []) {
        const relative = path.relative(directory, artifact.source)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
          throw new Error('Unowned edit artifact')
        const owned = { ...artifact, identity: undefined as string | undefined }
        operation.published.push(owned)
        agentSessionEditService.save(operation)
        await mkdir(path.dirname(artifact.target), { recursive: true })
        await publishForkArtifact(artifact.source, artifact.target, signal, (identity) => {
          owned.identity = identity
          agentSessionEditService.save(operation)
        })
      }
      signal.throwIfAborted()
      await this.host.closeForEdit(sessionId)
      signal.throwIfAborted()
      connection = await this.host.connectForEdit(
        {
          sessionId,
          agentId: validated.agentId,
          modelId: validated.uniqueModelId,
          reasoningEffort: validated.reasoningEffort,
          serviceTier: validated.serviceTier,
          knowledgeBaseIds: getKnowledgeBaseIdsFromParts(validated.userMessageParts) ?? [],
          fastMode: validated.fastMode,
          nativeSessionId: operation.nativeSessionId,
          resumeToken: native?.resumeToken,
          requireExistingHistory: !!native
        },
        validated.agentType
      )
      let context = operation.rebuilt
        ? db.withWriteTx((tx) =>
            agentSessionForkContextService.createDocumentTx(tx, snapshot.prefix, sessionId, snapshot.prefix)
          )
        : undefined
      if (context) {
        if (
          previous?.preparedContext &&
          forkContextHash(previous.preparedContext.snapshot.entries) === forkContextHash(context.snapshot.entries)
        )
          context = previous.preparedContext
        const message = {
          ...agentSessionMessageService.getSessionMessage(sessionId, target.messageId),
          id: validated.userMessageId,
          data: { parts: validated.userMessageParts }
        }
        const input = await resolveForkContextInput({
          sessionId,
          runtime: validated.agentType,
          modelId: validated.uniqueModelId,
          message,
          connection,
          signal
        })
        context = await prepareForkContextDocument(input, context)
        operation.preparedContext = context
        agentSessionEditService.save(operation)
      }
      signal.throwIfAborted()
      await validateEditedReferences(validated)
      signal.throwIfAborted()
      let checkpointIndex = 0
      const prefix = snapshot.prefix.map((row) => {
        const state = RuntimeForkStateSchema.safeParse(row.runtimeForkState)
        return {
          id: row.id,
          runtimeResumeToken: native && row.role === 'assistant' ? native.resumeToken : null,
          runtimeForkState:
            native && state.success && state.data.status === 'available'
              ? { ...state.data, checkpoint: native.checkpoints[checkpointIndex++] }
              : null
        }
      })
      validated.shouldAutoNameInitialTurn = false
      this.host.assertIdleForEdit(sessionId, true)
      const persisted = db.withWriteTx((tx) => {
        operation.status = 'prepared'
        agentSessionEditService.saveTx(tx, operation)
        agentSessionMessageService.replaceEditTailTx(tx, snapshot, prefix)
        const result = persist(tx)
        agentSessionForkContextService.replaceForEditTx(tx, sessionId, context)
        operation.status = 'committed'
        operation.committedAt = Math.max(Date.now(), (agentSessionEditService.current(sessionId)?.committedAt ?? 0) + 1)
        operation.userMessageId = result.userMessage.id
        operation.assistantMessageId = result.assistantMessageId
        operation.preparedContext = undefined
        agentSessionEditService.saveTx(tx, operation)
        return result
      })
      notifyDataApiDataChange([
        { endpoint: '/agent-sessions/:sessionId/messages', kind: 'projection', routeParams: { sessionId } }
      ])
      return { persisted, connection }
    } catch (error) {
      if (connection) {
        try {
          await connection.close()
        } catch {
          safeToClean = false
        }
      }
      const durable = agentSessionEditService.get(operation.operationId)
      if (!durable?.committedAt) {
        operation.committedAt = undefined
        operation.userMessageId = undefined
        operation.assistantMessageId = undefined
        operation.preparedContext ??= durable?.preparedContext
        operation.status = 'failed'
      }
      if (!safeToClean) {
        operation.executionUncertain = true
        agentSessionEditService.save(operation)
      }
      // The durable commit, not a mutated local object, decides whether rollback is permitted.
      if (!durable?.committedAt && safeToClean) {
        await this.cleanup(operation).catch((cleanupError) =>
          logger.warn('Edit cleanup remains pending', { cleanupError })
        )
      }
      throw error
    }
  }

  async recover(): Promise<void> {
    for (const operation of agentSessionEditService.list()) {
      if (
        operation.committedAt &&
        operation.status === 'preparing' &&
        !operation.executionUncertain &&
        !this.pending.has(operation.sessionId)
      )
        agentSessionEditService.save({ ...operation, status: 'committed' })
      if (operation.committedAt || operation.cleanupComplete || this.pending.has(operation.sessionId)) continue
      await this.cleanup(operation).catch((error) => logger.warn('Edit recovery retained owned artifacts', { error }))
    }
  }

  private async cleanup(operation: AgentSessionEditOperation): Promise<void> {
    if (operation.committedAt || operation.cleanupComplete) return
    if (operation.executionUncertain) throw new AgentSessionEditError('close_failed')
    const root = path.resolve(application.getPath('feature.agents.forks'))
    const directory = path.resolve(operation.artifactDirectory)
    if (path.dirname(directory) !== root || !/^edit-[\da-f-]{36}$/.test(path.basename(directory)))
      throw new Error('Edit directory is outside its owned artifact root')
    const identity = async (file: string) => {
      try {
        return await forkFileIdentity(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    }
    for (const file of operation.published) {
      const current = await identity(file.target)
      if (!current) continue
      if (current !== (file.identity ?? (await identity(file.source))))
        throw new Error('Edit artifact ownership changed')
      await rm(file.target)
    }
    const current = await identity(operation.artifactDirectory)
    if (current) {
      if (!operation.artifactIdentity || current !== operation.artifactIdentity)
        throw new Error('Edit directory ownership changed')
      await rm(operation.artifactDirectory, { recursive: true })
    }
    operation.cleanupComplete = true
    operation.status = 'failed'
    agentSessionEditService.save(operation)
  }
}
