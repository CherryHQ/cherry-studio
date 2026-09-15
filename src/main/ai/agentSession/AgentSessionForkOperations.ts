import { randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, renameSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { getAgentSessionForkAvailability } from '@data/services/agentSessionFork'
import { AgentSessionForkJournalSchema } from '@data/services/agentSessionForkJournal'
import { type AgentSessionForkJournal, agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { t } from '@main/i18n'

import {
  AgentSessionForkError,
  type RuntimeForkCheckpoint,
  RuntimeForkMetadataSchema,
  RuntimeForkStateSchema
} from '../runtime/forkCheckpoint'
import { runtimeDriverRegistry } from '../runtime/registry'
import { copyForkWorkspace, forkFileIdentity, publishForkArtifact } from './forkFiles'
import { workspaceHasReferences } from './forkWorkspaceCleanup'

const logger = loggerService.withContext('AgentSessionForkOperations')

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** Per-runtime-host operation owner. No source connection is started, closed or mutated by fork. */
export class AgentSessionForkOperations {
  private recoveryChain: Promise<void> = Promise.resolve()
  readonly pending = new Map<
    string,
    { sourceSessionId: string; promise: Promise<string>; controller: AbortController }
  >()

  fork(sourceSessionId: string, messageId: string): Promise<string> {
    const key = JSON.stringify([sourceSessionId, messageId])
    const current = this.pending.get(key)
    if (current) return current.promise
    const controller = new AbortController()
    // Register before any asynchronous work can escape the host's backup/shutdown drain.
    const promise = Promise.resolve()
      .then(() => this.run(sourceSessionId, messageId, controller.signal))
      .finally(() => this.pending.delete(key))
    this.pending.set(key, { sourceSessionId, promise, controller })
    return promise
  }

  async cancel(sourceSessionId?: string): Promise<void> {
    const operations = [...this.pending.values()].filter(
      (value) => !sourceSessionId || value.sourceSessionId === sourceSessionId
    )
    for (const operation of operations) operation.controller.abort(new AgentSessionForkError('cancelled'))
    await Promise.allSettled(operations.map((value) => value.promise))
  }

  recover(includeUncommitted = false): Promise<void> {
    const recovery = this.recoveryChain.then(() => this.recoverOnce(includeUncommitted))
    this.recoveryChain = recovery.catch(() => undefined)
    return recovery
  }

  private async recoverOnce(includeUncommitted: boolean): Promise<void> {
    for (const value of agentSessionForkService.journals()) {
      const parsed = AgentSessionForkJournalSchema.safeParse(value)
      if (!parsed.success) {
        logger.warn('Invalid fork recovery record retained')
        continue
      }
      if (parsed.data.cleanupComplete) continue
      if (parsed.data.version === 1) parsed.data.workspaceDisposition = 'retained'
      if (!includeUncommitted && !parsed.data.committed) continue
      if (agentSessionForkService.hasCommittedChild(parsed.data)) continue
      try {
        await this.cleanup(parsed.data)
      } catch (error) {
        logger.warn('Fork cleanup remains pending', { operationId: parsed.data.operationId, error })
      }
    }
  }

  private async run(sourceSessionId: string, messageId: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const preliminary = agentSessionForkService.read(sourceSessionId, messageId)
    const selected = preliminary.messages.at(-1)!
    const state = RuntimeForkStateSchema.safeParse(selected.runtimeForkState)
    if (selected.role !== 'assistant' || selected.status !== 'success')
      throw new AgentSessionForkError('not_turn_boundary')
    const availability = getAgentSessionForkAvailability(selected.runtimeForkState)
    if (availability.status === 'unavailable') throw new AgentSessionForkError(availability.reason)
    if (!state.success || state.data.status !== 'available') throw new AgentSessionForkError('unsupported_checkpoint')
    const excludedIds = [
      ...new Set([
        ...(RuntimeForkMetadataSchema.safeParse(selected.runtimeForkState).data?.excludedMessageIds ?? []),
        ...preliminary.messages
          .filter(
            (row) =>
              row.id !== messageId &&
              (row.status === 'pending' ||
                row.status === 'streaming' ||
                row.deliveryStatus === 'accepted' ||
                row.deliveryStatus === 'delivering')
          )
          .map((row) => row.id)
      ])
    ]
    const source = agentSessionForkService.read(sourceSessionId, messageId, excludedIds)
    const checkpoint = state.data.checkpoint
    const driver = runtimeDriverRegistry.getAgentSessionDriver(source.agent.type)
    if (source.agent.type !== checkpoint.runtime || !driver?.fork)
      throw new AgentSessionForkError('unsupported_checkpoint')
    const checkpoints: RuntimeForkCheckpoint[] = []
    for (const row of source.messages) {
      const parsed = RuntimeForkStateSchema.safeParse(row.runtimeForkState)
      if (parsed.success && parsed.data.status === 'available') checkpoints.push(parsed.data.checkpoint)
    }
    const root = application.getPath('feature.agents.forks')
    const operationId = randomUUID()
    const journal: AgentSessionForkJournal = {
      version: 2,
      operationId,
      sourceSessionId,
      messageId,
      targetSessionId: randomUUID(),
      createdAt: Date.now(),
      artifactDirectory: path.join(root, operationId),
      published: [],
      committed: false
    }
    await mkdir(root, { recursive: true })
    let targetCwd = source.workspace.path
    // Record intent before creating anything. A crash before recording inode ownership
    // leaves a recoverable record, never an untracked directory or permission to delete a collision.
    agentSessionForkService.writeJournal(journal)
    try {
      await mkdir(journal.artifactDirectory, { recursive: false })
      journal.artifactIdentity = await forkFileIdentity(journal.artifactDirectory)
      agentSessionForkService.writeJournal(journal)
      if (source.workspace.type === 'system') {
        targetCwd = agentWorkspaceService.buildSystemWorkspacePath(
          application.getPath('feature.agents.system_workspaces'),
          journal.targetSessionId,
          journal.createdAt
        )
        journal.workspace = targetCwd
        agentSessionForkService.writeJournal(journal)
        await mkdir(path.dirname(targetCwd), { recursive: true })
        await copyForkWorkspace(source.workspace.path, targetCwd, signal, (identity) => {
          journal.workspaceIdentity = identity
          agentSessionForkService.writeJournal(journal)
        })
      }
      signal.throwIfAborted()
      const result = await driver.fork({
        sourceSessionId,
        checkpoint,
        checkpoints,
        targetSessionId: journal.targetSessionId,
        targetCwd,
        artifactDirectory: journal.artifactDirectory,
        signal
      })
      if (!result.resumeToken.trim() || result.checkpoints.length !== checkpoints.length)
        throw new AgentSessionForkError('history_corrupt')
      signal.throwIfAborted()
      const messages = cloneMessages(source.messages, journal.targetSessionId, result.resumeToken, result.checkpoints)
      for (const artifact of result.publish) {
        if (!isInside(journal.artifactDirectory, artifact.source)) throw new Error('Unowned SDK fork artifact')
        await forkFileIdentity(artifact.source)
        await mkdir(path.dirname(artifact.target), { recursive: true })
        // Journal the intent first. Hard-link publication is exclusive and gives recovery an
        // inode ownership proof even if the process dies before the next DB write.
        const owned = { ...artifact, identity: undefined as string | undefined }
        journal.published.push(owned)
        agentSessionForkService.writeJournal(journal)
        await publishForkArtifact(artifact.source, artifact.target, signal, (identity) => {
          owned.identity = identity
          agentSessionForkService.writeJournal(journal)
        })
      }
      signal.throwIfAborted()
      agentSessionForkService.commit({ journal, source, excludedIds, messages })
      journal.committed = true
      return journal.targetSessionId
    } catch (error) {
      if (!journal.committed && !agentSessionForkService.hasCommittedChild(journal)) {
        try {
          await this.cleanup(journal)
        } catch (cleanupError) {
          logger.warn('Fork rollback requires recovery', { operationId, error: cleanupError })
        }
      }
      if (!signal.aborted && error instanceof AgentSessionForkError) {
        agentSessionForkService.markUnavailable(sourceSessionId, messageId, error.reason)
      }
      throw error
    }
  }

  private async cleanup(journal: AgentSessionForkJournal): Promise<void> {
    if (journal.cleanupComplete || agentSessionForkService.hasCommittedChild(journal)) return
    if (journal.version === 1) journal.workspaceDisposition = 'retained'
    try {
      await this.cleanupOwned(journal)
      journal.cleanupComplete = true
    } finally {
      if (journal.cleanupComplete && journal.workspaceDisposition !== 'retained')
        agentSessionForkService.removeJournal(journal.operationId)
      else agentSessionForkService.writeJournal(journal)
    }
  }

  private async cleanupOwned(journal: AgentSessionForkJournal): Promise<void> {
    const root = application.getPath('feature.agents.forks')
    if (path.resolve(journal.artifactDirectory) !== path.resolve(root, journal.operationId))
      throw new Error('Unowned fork directory')
    for (const artifact of journal.published) {
      if (!isInside(journal.artifactDirectory, artifact.source)) throw new Error('Unowned fork file')
      try {
        const targetIdentity = await forkFileIdentity(artifact.target)
        if (targetIdentity !== (artifact.identity ?? (await forkFileIdentity(artifact.source))))
          throw new Error('Fork file ownership changed')
        await rm(artifact.target)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    if (journal.workspace && journal.workspaceDisposition !== 'retained') {
      const expected = agentWorkspaceService.buildSystemWorkspacePath(
        application.getPath('feature.agents.system_workspaces'),
        journal.targetSessionId,
        journal.createdAt
      )
      if (path.resolve(expected) !== path.resolve(journal.workspace)) throw new Error('Unowned fork workspace')
      const workspaceInfo = lstatSync(expected, { bigint: true, throwIfNoEntry: false })
      if (workspaceInfo) {
        if (
          !workspaceInfo.isDirectory() ||
          workspaceInfo.ino === 0n ||
          [workspaceInfo.dev, workspaceInfo.ino].join(':') !== journal.workspaceIdentity
        ) {
          throw new Error('Fork workspace ownership is unproven; retained for recovery')
        }
        if (
          workspaceHasReferences(
            expected,
            agentWorkspaceService.list({ includeSystem: true }).map((row) => row.path)
          )
        ) {
          // Terminal retention: releasing the other workspace later must never resurrect deletion.
          journal.workspaceDisposition = 'retained'
          agentSessionForkService.writeJournal(journal)
        } else {
          const artifactInfo = lstatSync(journal.artifactDirectory, { bigint: true })
          if (
            !artifactInfo.isDirectory() ||
            artifactInfo.ino === 0n ||
            [artifactInfo.dev, artifactInfo.ino].join(':') !== journal.artifactIdentity
          )
            throw new Error('Fork directory ownership is unproven; retained for recovery')
          // No await between the reference check and detach; later cleanup never targets a recreated workspace.
          const disposal = mkdtempSync(path.join(journal.artifactDirectory, 'workspace-disposal-'))
          renameSync(expected, path.join(disposal, 'workspace'))
        }
      }
    }
    try {
      if ((await lstat(journal.artifactDirectory)).isSymbolicLink()) throw new Error('Fork directory is a link')
      if (
        !journal.artifactIdentity ||
        (await forkFileIdentity(journal.artifactDirectory)) !== journal.artifactIdentity
      ) {
        throw new Error('Fork directory ownership is unproven; retained for recovery')
      }
      await rm(journal.artifactDirectory, { recursive: true, force: true })
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

function cloneMessages(
  rows: readonly AgentSessionMessageRow[],
  targetSessionId: string,
  resumeToken: string,
  checkpoints: RuntimeForkCheckpoint[]
): AgentSessionMessageRow[] {
  // Preserve the existing (createdAt, id) order even when several source rows share a timestamp.
  const newIds = rows.map(() => randomUUID()).sort()
  const ids = new Map(rows.map((row, index) => [row.id, newIds[index]]))
  let checkpointIndex = 0
  return rows.map((row) => {
    const state = RuntimeForkStateSchema.safeParse(row.runtimeForkState)
    const metadata = RuntimeForkMetadataSchema.safeParse(row.runtimeForkState)
    const forkState =
      state.success && state.data.status === 'available'
        ? {
            ...state.data,
            checkpoint: checkpoints[checkpointIndex++],
            excludedMessageIds: state.data.excludedMessageIds?.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
          }
        : metadata.success
          ? {
              ...metadata.data,
              excludedMessageIds: metadata.data.excludedMessageIds?.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
            }
          : row.runtimeForkState
    const data = structuredClone(row.data)
    // Task events are live execution registries, not conversation content.
    data.parts = data.parts
      ?.filter((part) => part.type !== 'data-agent-task-event')
      .map((part) => {
        if (part.type === 'data-translation' && part.data.sourceBlockId) {
          return {
            ...part,
            data: { ...part.data, sourceBlockId: ids.get(part.data.sourceBlockId) ?? part.data.sourceBlockId }
          }
        }
        if (!('toolCallId' in part)) return part
        if (
          part.state === 'approval-requested' ||
          part.state === 'approval-responded' ||
          part.state === 'input-available' ||
          part.state === 'input-streaming'
        ) {
          const interrupted = {
            toolCallId: part.toolCallId,
            input: part.input,
            state: 'output-error' as const,
            errorText: t('agent.session.fork.execution_not_inherited')
          }
          return part.type === 'dynamic-tool'
            ? { ...interrupted, type: part.type, toolName: part.toolName }
            : { ...interrupted, type: part.type }
        }
        const copy = { ...part }
        delete copy.approval
        return copy
      })
    return {
      ...row,
      id: ids.get(row.id)!,
      sessionId: targetSessionId,
      data,
      runtimeForkState: forkState,
      runtimeResumeToken: row.role === 'assistant' ? resumeToken : null,
      stats: null,
      ftsRowid: null,
      delivery: null,
      deliveryStatus: null,
      deliveryTurnRef: null,
      deliveryInReplyTo: null,
      deliverySenderSessionId: null
    }
  })
}
