import { randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, renameSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentService } from '@data/services/AgentService'
import { AgentSessionForkSourceError, agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import { type RuntimeForkCheckpoint, RuntimeForkAnchorSchema } from '@main/ai/runtime/fork'
import { AgentSessionForkError } from '@main/ai/runtime/fork'
import { t } from '@main/i18n'

import { runtimeDriverRegistry } from '../../runtime/registry'
import { copyForkWorkspace, forkFileIdentity, publishForkArtifact } from './files'
import { type AgentSessionForkResources, readForkResources, writeForkResources, removeForkResources } from './resources'
import { workspaceHasReferences } from './workspaceCleanup'

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
    { sourceSessionId: string; operationId: string; promise: Promise<string>; controller: AbortController }
  >()

  fork(sourceSessionId: string, messageId: string): Promise<string> {
    const key = JSON.stringify([sourceSessionId, messageId])
    const current = this.pending.get(key)
    if (current) return current.promise
    const controller = new AbortController()
    const operationId = randomUUID()
    // Register before any asynchronous work can escape the host's backup/shutdown drain.
    const promise = Promise.resolve()
      .then(() => this.run(sourceSessionId, messageId, operationId, controller.signal))
      .finally(() => this.pending.delete(key))
    this.pending.set(key, { sourceSessionId, operationId, promise, controller })
    return promise
  }

  async cancel(sourceSessionId?: string): Promise<void> {
    const operations = [...this.pending.values()].filter(
      (value) => !sourceSessionId || value.sourceSessionId === sourceSessionId
    )
    for (const operation of operations) operation.controller.abort(new AgentSessionForkError('cancelled'))
    await Promise.allSettled(operations.map((value) => value.promise))
  }

  recover(): Promise<void> {
    const recovery = this.recoveryChain.then(() => this.recoverOnce())
    this.recoveryChain = recovery.catch(() => undefined)
    return recovery
  }

  private async recoverOnce(): Promise<void> {
    for (const resources of await readForkResources()) {
      if ([...this.pending.values()].some((operation) => operation.operationId === resources.operationId)) continue
      if (agentSessionForkService.hasPublishedSession(resources.targetSessionId)) continue
      try {
        await this.cleanup(resources)
      } catch (error) {
        logger.warn('Fork cleanup remains pending', { operationId: resources.operationId, error })
      }
    }
  }

  private async run(
    sourceSessionId: string,
    messageId: string,
    operationId: string,
    signal: AbortSignal
  ): Promise<string> {
    signal.throwIfAborted()
    const preliminary = agentSessionForkService.read(sourceSessionId, messageId)
    const selected = preliminary.messages.at(-1)!
    const anchor = RuntimeForkAnchorSchema.safeParse(selected.data.runtimeAnchor)
    if (selected.role !== 'assistant' || selected.status !== 'success')
      throw new AgentSessionForkError('not_turn_boundary')
    if (!anchor.success)
      throw new AgentSessionForkError(selected.data.runtimeAnchor == null ? 'legacy_history' : 'unsupported_checkpoint')
    const excludedIds = [
      ...new Set([
        ...(anchor.data.excludedMessageIds ?? []),
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
    const checkpoint = anchor.data.checkpoint
    const agent = agentService.getAgent(source.agent.id)
    if (!agent) throw new AgentSessionForkSourceError('source_missing')
    const driver = runtimeDriverRegistry.getAgentSessionDriver(agent.type)
    if (agent.type !== checkpoint.runtime || !driver?.fork) throw new AgentSessionForkError('unsupported_checkpoint')
    const checkpoints: RuntimeForkCheckpoint[] = []
    for (const row of source.messages) {
      const parsed = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor)
      if (parsed.success) checkpoints.push(parsed.data.checkpoint)
    }
    const root = application.getPath('feature.agents.forks')
    const resources: AgentSessionForkResources = {
      version: 1,
      operationId,
      targetSessionId: randomUUID(),
      createdAt: Date.now(),
      artifactDirectory: path.join(root, operationId),
      published: []
    }
    await mkdir(root, { recursive: true })
    let targetCwd = source.workspace.path
    // Record intent before creating anything. A crash before recording inode ownership
    // leaves a recoverable record, never an untracked directory or permission to delete a collision.
    await writeForkResources(resources)
    try {
      await mkdir(resources.artifactDirectory, { recursive: false })
      resources.artifactIdentity = await forkFileIdentity(resources.artifactDirectory)
      await writeForkResources(resources)
      if (source.workspace.type === 'system') {
        targetCwd = agentWorkspaceService.buildSystemWorkspacePath(
          application.getPath('feature.agents.system_workspaces'),
          resources.targetSessionId,
          resources.createdAt
        )
        resources.workspace = targetCwd
        await writeForkResources(resources)
        await mkdir(path.dirname(targetCwd), { recursive: true })
        await copyForkWorkspace(source.workspace.path, targetCwd, signal, async (identity) => {
          resources.workspaceIdentity = identity
          await writeForkResources(resources)
        })
      }
      signal.throwIfAborted()
      const result = await driver.fork({
        sourceSessionId,
        checkpoint,
        checkpoints,
        targetSessionId: resources.targetSessionId,
        targetCwd,
        artifactDirectory: resources.artifactDirectory,
        signal
      })
      if (!result.resumeToken.trim() || result.checkpoints.length !== checkpoints.length)
        throw new AgentSessionForkError('history_corrupt')
      signal.throwIfAborted()
      const messages = cloneMessages(source.messages, resources.targetSessionId, result.resumeToken, result.checkpoints)
      for (const artifact of result.publish) {
        if (!isInside(resources.artifactDirectory, artifact.source)) throw new Error('Unowned SDK fork artifact')
        await forkFileIdentity(artifact.source)
        await mkdir(path.dirname(artifact.target), { recursive: true })
        // Record intent first. Hard-link publication is exclusive and gives recovery an
        // inode ownership proof even if the process dies before the next resource write.
        const owned = { ...artifact, identity: undefined as string | undefined }
        resources.published.push(owned)
        await writeForkResources(resources)
        await publishForkArtifact(artifact.source, artifact.target, signal, async (identity) => {
          owned.identity = identity
          await writeForkResources(resources)
        })
      }
      signal.throwIfAborted()
      application.get('DbService').withWriteTx((tx) => {
        agentSessionForkService.commitTx(tx, {
          targetSessionId: resources.targetSessionId,
          createdAt: resources.createdAt,
          source,
          excludedIds,
          messages,
          messageId
        })
      })
      agentSessionService.notifyReadModelChange([resources.targetSessionId], 'membership')
      return resources.targetSessionId
    } catch (error) {
      if (!agentSessionForkService.hasPublishedSession(resources.targetSessionId)) {
        try {
          await this.cleanup(resources)
        } catch (cleanupError) {
          logger.warn('Fork rollback requires recovery', { operationId, error: cleanupError })
        }
      }
      throw error
    }
  }

  private async cleanup(resources: AgentSessionForkResources): Promise<void> {
    if (agentSessionForkService.hasPublishedSession(resources.targetSessionId)) return
    await this.cleanupOwned(resources)
    await removeForkResources(resources.operationId)
  }

  private async cleanupOwned(resources: AgentSessionForkResources): Promise<void> {
    const root = application.getPath('feature.agents.forks')
    if (path.resolve(resources.artifactDirectory) !== path.resolve(root, resources.operationId))
      throw new Error('Unowned fork directory')
    for (const artifact of resources.published) {
      if (!isInside(resources.artifactDirectory, artifact.source)) throw new Error('Unowned fork file')
      try {
        const targetIdentity = await forkFileIdentity(artifact.target)
        if (targetIdentity !== (artifact.identity ?? (await forkFileIdentity(artifact.source))))
          throw new Error('Fork file ownership changed')
        await rm(artifact.target)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    if (resources.workspace && resources.workspaceDisposition !== 'retained') {
      const expected = agentWorkspaceService.buildSystemWorkspacePath(
        application.getPath('feature.agents.system_workspaces'),
        resources.targetSessionId,
        resources.createdAt
      )
      if (path.resolve(expected) !== path.resolve(resources.workspace)) throw new Error('Unowned fork workspace')
      const workspaceInfo = lstatSync(expected, { bigint: true, throwIfNoEntry: false })
      if (workspaceInfo) {
        if (
          !workspaceInfo.isDirectory() ||
          workspaceInfo.ino === 0n ||
          [workspaceInfo.dev, workspaceInfo.ino].join(':') !== resources.workspaceIdentity
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
          resources.workspaceDisposition = 'retained'
          await writeForkResources(resources)
        } else {
          const artifactInfo = lstatSync(resources.artifactDirectory, { bigint: true })
          if (
            !artifactInfo.isDirectory() ||
            artifactInfo.ino === 0n ||
            [artifactInfo.dev, artifactInfo.ino].join(':') !== resources.artifactIdentity
          )
            throw new Error('Fork directory ownership is unproven; retained for recovery')
          // No await between the reference check and detach; later cleanup never targets a recreated workspace.
          const disposal = mkdtempSync(path.join(resources.artifactDirectory, 'workspace-disposal-'))
          renameSync(expected, path.join(disposal, 'workspace'))
        }
      }
    }
    try {
      if ((await lstat(resources.artifactDirectory)).isSymbolicLink()) throw new Error('Fork directory is a link')
      if (
        !resources.artifactIdentity ||
        (await forkFileIdentity(resources.artifactDirectory)) !== resources.artifactIdentity
      ) {
        throw new Error('Fork directory ownership is unproven; retained for recovery')
      }
      await rm(resources.artifactDirectory, { recursive: true, force: true })
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
  return rows.map((row, index) => {
    const data = structuredClone(row.data)
    const anchor = RuntimeForkAnchorSchema.safeParse(data.runtimeAnchor)
    delete data.runtimeAnchor
    if (anchor.success) {
      data.runtimeAnchor = RuntimeForkAnchorSchema.parse({
        checkpoint: checkpoints[checkpointIndex++],
        excludedMessageIds: anchor.data.excludedMessageIds?.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
      })
    }
    // Task events are live execution registries, not conversation content.
    data.parts = data.parts
      ?.filter((part) => part.type !== 'data-agent-task-event' && part.type !== 'data-agent-session-fork')
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
    if (index === rows.length - 1) {
      data.parts = [
        ...(data.parts ?? []),
        { type: 'data-agent-session-fork', data: { sourceSessionId: row.sessionId } }
      ]
    }
    return {
      ...row,
      id: ids.get(row.id)!,
      sessionId: targetSessionId,
      data,
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
