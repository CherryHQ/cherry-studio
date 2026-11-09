import { randomUUID } from 'node:crypto'
import { lstatSync, mkdtempSync, renameSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { AgentSessionEditError } from '@data/services/AgentSessionEditError'
import { AgentSessionForkSourceError, agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'
import { loggerService } from '@logger'
import { type RuntimeForkCheckpoint, type RuntimeForkResult, RuntimeForkAnchorSchema } from '@main/ai/runtime/fork'
import { AgentSessionForkError } from '@main/ai/runtime/fork'
import { t } from '@main/i18n'
import { isOutsidePath } from '@main/utils/file'
import type { AgentSessionEditTarget } from '@shared/ai/agentSessionEdit'
import { Sequencer } from '@shared/utils/async'

import { ensureRetiredSessionHistory } from '../../runtime/pi/retiredSessionHistory'
import { runtimeDriverRegistry } from '../../runtime/registry'
import { copyForkWorkspace, forkFileIdentity, publishForkArtifact } from './files'
import { getEditFailure, resolveForkBoundary } from './historyActions'
import { type AgentSessionForkResources, readForkResources, writeForkResources, removeForkResources } from './resources'
import { workspaceHasReferences } from './workspaceCleanup'

const logger = loggerService.withContext('AgentSessionForkOperations')

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function assertArtifactSource(directory: string, source: string): void {
  const relative = path.relative(directory, source)
  if (!relative || isOutsidePath(relative)) throw new Error('Unowned SDK fork artifact')
}

/** Owns native history publication for forks and in-place edits. */
export class AgentSessionForkOperations {
  private readonly recoveryQueue = new Sequencer()
  readonly edits = new Map<string, { operationId: string; controller: AbortController; promise: Promise<unknown> }>()
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
    const edits = [...this.edits.entries()].filter(([sessionId]) => !sourceSessionId || sessionId === sourceSessionId)
    for (const [, edit] of edits) edit.controller.abort(new AgentSessionForkError('cancelled'))
    await Promise.allSettled([...operations.map((value) => value.promise), ...edits.map(([, edit]) => edit.promise)])
  }

  edit<T>(
    sessionId: string,
    target: AgentSessionEditTarget,
    closeSource: () => Promise<void>,
    persist: (tx: DbOrTx, nativeSessionId: string) => T
  ): Promise<T> {
    if (this.edits.has(sessionId)) return Promise.reject(new AgentSessionEditError('busy'))
    const operationId = randomUUID()
    const controller = new AbortController()
    const promise = Promise.resolve()
      .then(() => this.runEdit(sessionId, target, operationId, controller.signal, closeSource, persist))
      .finally(() => this.edits.delete(sessionId))
    this.edits.set(sessionId, { operationId, controller, promise })
    return promise
  }

  private async runEdit<T>(
    sessionId: string,
    target: AgentSessionEditTarget,
    operationId: string,
    signal: AbortSignal,
    closeSource: () => Promise<void>,
    persist: (tx: DbOrTx, nativeSessionId: string) => T
  ): Promise<T> {
    await ensureRetiredSessionHistory(sessionId)
    const database = application.get('DbService')
    const source = database.withWriteTx((tx) =>
      agentSessionMessageService.readEditSnapshotTx(tx, sessionId, target.messageId)
    )
    if (source.version !== target.version) throw new AgentSessionEditError('history_changed')
    const agent = source.session.agentId ? agentService.getAgent(source.session.agentId) : undefined
    const driver = agent ? runtimeDriverRegistry.getAgentSessionDriver(agent.type) : undefined
    const facts = agentSessionForkService.readHistoryBoundaries(sessionId, [target.messageId])[0]
    const editFailure = facts ? getEditFailure(driver, facts, facts.parent) : 'invalid_target'
    if (editFailure) throw new AgentSessionEditError(editFailure)
    const prefix = structuredClone(source.prefix)
    const bindings = database.withWriteTx((tx) =>
      agentSessionForkService.readBindingsTx(tx, sessionId, target.messageId)
    )
    let nativeSessionId: string = randomUUID()
    let resources: AgentSessionForkResources | undefined
    try {
      if (prefix.length) {
        const row = prefix.at(-1)!
        const boundary = resolveForkBoundary(driver, { ...row, anchor: row.data.runtimeAnchor })
        if (boundary.reason) throw new AgentSessionEditError('checkpoint_unsupported')
        const { anchor } = boundary
        if (anchor.excludedMessageIds?.some((id) => prefix.some((row) => row.id === id)))
          throw new AgentSessionForkError('history_changed')
        const group = groupNativeHistory(prefix, bindings).find((group) => group.rows.at(-1)?.id === row.id)!
        if (group.context.locator.kind !== driver?.type) throw new AgentSessionEditError('checkpoint_unsupported')
        const checkpoints = group.rows.map((row) => RuntimeForkAnchorSchema.parse(row.data.runtimeAnchor).checkpoint)
        resources = {
          version: 1,
          operationId,
          targetSessionId: sessionId,
          resumeToken: '',
          createdAt: Date.now(),
          artifactDirectory: path.join(application.getPath('feature.agents.forks'), operationId),
          published: []
        }
        await this.prepareResources(resources)
        const native = await boundary.fork({
          sourceSessionId: sessionId,
          checkpoint: anchor.checkpoint,
          checkpoints,
          targetSessionId: nativeSessionId,
          targetCwd: source.workspace.path,
          artifactDirectory: resources.artifactDirectory,
          signal
        })
        if (!native.resumeToken.trim() || native.checkpoints.length !== checkpoints.length)
          throw new AgentSessionForkError('history_corrupt')
        nativeSessionId = native.resumeToken
        resources.resumeToken = native.resumeToken
        await writeForkResources(resources)
        remapNativeHistory(prefix, [{ group, result: native }])
        await this.publish(resources, native.publish, signal)
      }
      signal.throwIfAborted()
      await closeSource()
      signal.throwIfAborted()
      return database.withWriteTx((tx) => {
        if (
          JSON.stringify(agentSessionForkService.readBindingsTx(tx, sessionId, target.messageId)) !==
          JSON.stringify(bindings)
        )
          throw new AgentSessionEditError('history_changed')
        agentSessionMessageService.selectEditParentTx(tx, sessionId, target)
        const result = persist(tx, nativeSessionId)
        if (resources) {
          const checkpointMapping = Object.fromEntries(
            prefix.flatMap((row) => {
              const anchor = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor)
              return anchor.success && row.runtimeResumeToken === nativeSessionId
                ? [[row.id, anchor.data.checkpoint]]
                : []
            })
          )
          agentSessionContextService.publishBranchTx(tx, sessionId, nativeSessionId, checkpointMapping)
        }
        return result
      })
    } catch (error) {
      if (resources && !this.hasPublishedResources(resources)) {
        await this.cleanup(resources).catch((cleanupError) =>
          logger.warn('Edit rollback requires recovery', { operationId, error: cleanupError })
        )
      }
      throw error
    }
  }

  private hasPublishedResources(resources: AgentSessionForkResources): boolean {
    return resources.resumeToken === undefined
      ? agentSessionForkService.hasPublishedSession(resources.targetSessionId)
      : agentSessionMessageService.hasRuntimeResumeToken(resources.targetSessionId, resources.resumeToken)
  }

  recover(): Promise<void> {
    return this.recoveryQueue.queue(() => this.recoverOnce())
  }

  private async recoverOnce(): Promise<void> {
    for (const resources of await readForkResources()) {
      if ([...this.pending.values()].some((operation) => operation.operationId === resources.operationId)) continue
      if ([...this.edits.values()].some((operation) => operation.operationId === resources.operationId)) continue
      if (this.hasPublishedResources(resources)) {
        // Retire the journal before migration replaces its durable native token.
        if (getRetiredAgentSessionMigration(application.get('DbService').getDb(), resources.targetSessionId))
          await removeForkResources(resources.operationId)
        continue
      }
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
    await ensureRetiredSessionHistory(sourceSessionId)
    const preliminary = agentSessionForkService.read(sourceSessionId, messageId)
    const selected = preliminary.messages.at(-1)!
    const agent = agentService.getAgent(preliminary.agent.id)
    if (!agent) throw new AgentSessionForkSourceError('source_missing')
    const driver = runtimeDriverRegistry.getAgentSessionDriver(agent.type)
    const boundary = resolveForkBoundary(driver, { ...selected, anchor: selected.data.runtimeAnchor })
    if (boundary.reason) throw new AgentSessionForkError(boundary.reason)
    const { anchor } = boundary
    const excludedIds = [
      ...new Set([
        ...(anchor.excludedMessageIds ?? []),
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
    const groups = groupNativeHistory(source.messages, source.contexts)
    const resources: AgentSessionForkResources = {
      version: 1,
      operationId,
      targetSessionId: randomUUID(),
      createdAt: Date.now(),
      artifactDirectory: path.join(application.getPath('feature.agents.forks'), operationId),
      published: []
    }
    let targetCwd = source.workspace.path
    try {
      await this.prepareResources(resources)
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
      const prepared: PreparedContext[] = []
      for (const group of groups) {
        signal.throwIfAborted()
        if (group.context.locator.kind !== driver?.type) throw new AgentSessionForkError('unsupported_checkpoint')
        const row = group.rows.at(-1)!
        const selected = resolveForkBoundary(driver, { ...row, anchor: row.data.runtimeAnchor })
        if (selected.reason) throw new AgentSessionForkError(selected.reason)
        const artifactDirectory = path.join(resources.artifactDirectory, group.context.id)
        await mkdir(artifactDirectory)
        const checkpoints = group.rows.map((row) => RuntimeForkAnchorSchema.parse(row.data.runtimeAnchor).checkpoint)
        const result = await selected.fork({
          sourceSessionId,
          checkpoint: selected.anchor.checkpoint,
          checkpoints,
          targetSessionId: randomUUID(),
          targetCwd,
          artifactDirectory,
          signal
        })
        if (!result.resumeToken.trim() || result.checkpoints.length !== checkpoints.length)
          throw new AgentSessionForkError('history_corrupt')
        for (const artifact of result.publish) assertArtifactSource(artifactDirectory, artifact.source)
        prepared.push({ group, result })
      }
      signal.throwIfAborted()
      const messages = cloneMessages(source.messages, resources.targetSessionId, prepared)
      const positions = new Map(source.messages.map((row, index) => [row.id, index]))
      const contexts = prepared.map(({ group, result }, index) => {
        const first = positions.get(group.rows[0].id)!
        const start = source.contexts.reduce((latest, context) => {
          const position = context.anchorMessageId ? positions.get(context.anchorMessageId) : undefined
          return position !== undefined && position <= first && position > latest ? position : latest
        }, -1)
        if (index > 0 && start < 0) throw new AgentSessionForkError('history_changed')
        return {
          backendId: group.context.backendId,
          nativeThreadId: result.resumeToken,
          anchorMessageId: index === 0 ? null : messages[start].id
        }
      })
      await this.publish(
        resources,
        prepared.flatMap(({ result }) => result.publish),
        signal
      )
      signal.throwIfAborted()
      application.get('DbService').withWriteTx((tx) => {
        agentSessionForkService.commitTx(tx, {
          targetSessionId: resources.targetSessionId,
          createdAt: resources.createdAt,
          source,
          excludedIds,
          messages,
          contexts,
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
    if (this.hasPublishedResources(resources)) return
    await this.cleanupOwned(resources)
    await removeForkResources(resources.operationId)
  }

  private async prepareResources(resources: AgentSessionForkResources): Promise<void> {
    await mkdir(application.getPath('feature.agents.forks'), { recursive: true })
    // Record intent before creation so recovery never deletes a directory without proven ownership.
    await writeForkResources(resources)
    await mkdir(resources.artifactDirectory)
    resources.artifactIdentity = await forkFileIdentity(resources.artifactDirectory)
    await writeForkResources(resources)
  }

  private async publish(
    resources: AgentSessionForkResources,
    artifacts: Array<{ source: string; target: string }>,
    signal: AbortSignal
  ): Promise<void> {
    for (const artifact of artifacts) {
      assertArtifactSource(resources.artifactDirectory, artifact.source)
      await forkFileIdentity(artifact.source)
      await mkdir(path.dirname(artifact.target), { recursive: true })
      const owned = { ...artifact, identity: undefined as string | undefined }
      resources.published.push(owned)
      await writeForkResources(resources)
      await publishForkArtifact(artifact.source, artifact.target, signal, async (identity) => {
        owned.identity = identity
        await writeForkResources(resources)
      })
    }
  }

  private async cleanupOwned(resources: AgentSessionForkResources): Promise<void> {
    const root = application.getPath('feature.agents.forks')
    if (path.resolve(resources.artifactDirectory) !== path.resolve(root, resources.operationId))
      throw new Error('Unowned fork directory')
    for (const artifact of resources.published) {
      const relativeSource = path.relative(resources.artifactDirectory, artifact.source)
      if (!relativeSource || isOutsidePath(relativeSource)) throw new Error('Unowned fork file')
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

type ForkBinding = ReturnType<typeof agentSessionForkService.readBindingsTx>[number]
interface NativeHistoryGroup {
  context: ForkBinding
  rows: AgentSessionMessageRow[]
}
interface PreparedContext {
  group: NativeHistoryGroup
  result: RuntimeForkResult
}

function groupNativeHistory(rows: AgentSessionMessageRow[], contexts: ForkBinding[]): NativeHistoryGroup[] {
  const groups = new Map<string, NativeHistoryGroup>()
  for (const row of rows) {
    if (!RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor).success) continue
    const matches = contexts.filter(
      (context) => context.nativeThreadId && context.nativeThreadId === row.runtimeResumeToken
    )
    if (matches.length !== 1) throw new AgentSessionForkError('unsupported_checkpoint')
    const context = matches[0]
    let group = groups.get(context.id)
    if (!group) {
      group = { context, rows: [] }
      groups.set(context.id, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

function remapNativeHistory(rows: AgentSessionMessageRow[], prepared: PreparedContext[]): void {
  const checkpoints = new Map<string, RuntimeForkCheckpoint>()
  const tokens = new Map<string | null, string>()
  for (const { group, result } of prepared) {
    group.rows.forEach((row, index) => checkpoints.set(row.id, result.checkpoints[index]))
    tokens.set(group.context.nativeThreadId, result.resumeToken)
  }
  for (const row of rows) {
    const anchor = RuntimeForkAnchorSchema.safeParse(row.data.runtimeAnchor)
    const checkpoint = checkpoints.get(row.id)
    if (anchor.success && checkpoint) {
      row.data.runtimeAnchor = RuntimeForkAnchorSchema.parse({
        ...anchor.data,
        checkpoint
      })
    }
    if (row.runtimeResumeToken && tokens.has(row.runtimeResumeToken))
      row.runtimeResumeToken = tokens.get(row.runtimeResumeToken)!
  }
}

function cloneMessages(
  rows: readonly AgentSessionMessageRow[],
  targetSessionId: string,
  prepared: PreparedContext[]
): AgentSessionMessageRow[] {
  // Preserve the existing (createdAt, id) order even when several source rows share a timestamp.
  const newIds = rows.map(() => randomUUID()).sort()
  const ids = new Map(rows.map((row, index) => [row.id, newIds[index]]))
  const messages = rows.map((row) => structuredClone(row))
  remapNativeHistory(messages, prepared)
  const nativeIds = new Map(prepared.map(({ group, result }) => [group.context.nativeThreadId, result.resumeToken]))
  const copiedIds = new Set(nativeIds.values())
  return messages.map((row, index) => {
    const data = row.data
    const nativeId = data.nativeSessionId && nativeIds.get(data.nativeSessionId)
    if (nativeId) data.nativeSessionId = nativeId
    else delete data.nativeSessionId
    if (row.runtimeResumeToken && !copiedIds.has(row.runtimeResumeToken)) row.runtimeResumeToken = null
    const anchor = RuntimeForkAnchorSchema.safeParse(data.runtimeAnchor)
    if (anchor.success) {
      data.runtimeAnchor = {
        ...anchor.data,
        excludedMessageIds: anchor.data.excludedMessageIds?.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
      }
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
