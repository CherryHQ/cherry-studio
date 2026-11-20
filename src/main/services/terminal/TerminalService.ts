import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import type * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessInstance } from '@main/core/utilityProcess/types'
import { findExecutableInEnv, autoDiscoverGitBash } from '@main/utils/commandResolver'
import { getShellEnv } from '@main/utils/shellEnv'
import type { terminalViewAction } from '@shared/ipc/schemas/terminal'
import type { WindowId } from '@shared/ipc/types'
import type { TerminalViewFrame, GhosttyTheme, TerminalResourceView } from '@shared/types/terminal'

import {
  terminalConversationId,
  terminalGeneration,
  terminalLaunch,
  terminalOperationId,
  terminalResourceId,
  type TerminalCommand,
  type TerminalContext,
  type TerminalConversationId,
  type TerminalHostContract,
  type TerminalHostIdentity,
  type TerminalHostInit,
  type TerminalLaunch,
  type TerminalMutation,
  type TerminalReceipt,
  type TerminalResourceId,
  type TerminalResourceState,
  type TerminalRetention
} from './contracts'
import { TerminalCapture } from './TerminalCapture'

const logger = loggerService.withContext('TerminalService')
const definition = defineUtilityProcess<TerminalHostContract, TerminalHostInit>({
  id: 'terminal.host',
  entry: 'terminal-host',
  cancellation: 'cooperative'
})
const limits = { maxFrameBytes: 64 * 1024, maxBufferedBytes: 256 * 1024, maxBufferedFrames: 8, maxPendingWrites: 2 }
export interface TerminalLease {
  conversationId: TerminalConversationId
  context: TerminalContext
  workspaceRevision: number
}
export interface TerminalResourceRef {
  host: TerminalHostIdentity
  id: TerminalResourceId
}
interface Execution {
  ref: TerminalResourceRef
  kind: TerminalLaunch['kind']
  state?: TerminalResourceState
  toolCallId?: string
  usageId?: string
  output: TerminalCapture
  ready: Promise<TerminalReceipt>
  onOutput?: (data: Uint8Array, truncated: boolean, source: 'stdout' | 'stderr' | 'terminal') => void
  outputError?: unknown
  screen?: TerminalViewFrame[]
}
interface Binding {
  signature: string
  execution: Execution
}
interface Host {
  identity: TerminalHostIdentity
  instance: UtilityProcessInstance<TerminalHostContract>
  ready: Promise<void>
  sequence: number
  admissionRevision: number
  pending: number
  resources: Set<TerminalResourceId>
  phase: 'starting' | 'ready' | 'closing' | 'lost'
  observer: AbortController
  retirement?: Promise<void>
}
interface Conversation {
  id: TerminalConversationId
  sealed: boolean
  revision: number
  workspaceRevision: number
  changingWorkspace: boolean
  admissions: number
  preparations: Set<Promise<void>>
  contexts: Map<string, TerminalContext>
  bindings: Map<string, Binding>
  executions: Map<TerminalResourceId, Execution>
  host?: Host
}

@Injectable('TerminalService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['UtilityProcessManager', 'AgentWorkspaceStorageService'])
export class TerminalService extends BaseService {
  private readonly changes = new Emitter<TerminalConversationId>()
  readonly onDidChange = this.changes.event
  private readonly views = new Map<
    string,
    { owner: WindowId; ref: TerminalResourceRef; pending: boolean; offset: number }
  >()
  private readonly controllingViews = new Map<TerminalResourceId, string>()
  private readonly windows = new Set<WindowId>()
  private readonly mutations = new Map<string, { signature: string; receipt: Promise<TerminalReceipt> }>()
  private readonly conversations = new Map<TerminalConversationId, Conversation>()
  private readonly hosts = new Set<Host>()
  private accepting = true
  private bindingCount = 0
  private pending = 0
  private screenBytes = 0

  protected onInit(): void {
    this.registerDisposable(this.changes)
    application.get('UtilityProcessManager').register(definition)
  }

  async availableShells(): Promise<Array<'bash' | 'powershell'>> {
    const env = await getShellEnv()
    const configured = path
      .basename(
        env.SHELL ||
          process.env.SHELL ||
          (process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'zsh' : 'bash')
      )
      .replace(/\.exe$/i, '')
      .toLowerCase()
    const bash =
      process.platform === 'win32'
        ? (autoDiscoverGitBash() ?? (await findExecutableInEnv('bash', { env })))
        : await findExecutableInEnv('bash', { env })
    const powershell =
      (await findExecutableInEnv('pwsh', { env })) ?? (await findExecutableInEnv('powershell', { env }))
    return [
      ...(bash && configured !== 'bash' ? ['bash' as const] : []),
      ...(powershell && configured !== 'pwsh' && configured !== 'powershell' ? ['powershell' as const] : [])
    ]
  }

  async createUserTerminal(
    conversationId: string,
    cwd: string,
    shell: 'default' | 'bash' | 'powershell',
    replayKey: string,
    workspaceRevision: number,
    prepare: () => Promise<void>
  ): Promise<TerminalReceipt> {
    const conversation = this.conversation(conversationId)
    if (!this.accepting || conversation.sealed) return { kind: 'rejected', reason: 'closing' }
    if (workspaceRevision !== conversation.workspaceRevision) return { kind: 'rejected', reason: 'stale_context' }
    const preparation = Promise.withResolvers<void>()
    conversation.preparations.add(preparation.promise)
    let usageId: string | undefined
    try {
      usageId = await application.get('AgentWorkspaceStorageService').acquireUsage({
        sessionId: conversationId,
        cwd,
        owner: { kind: 'preparation', operationId: replayKey }
      })
      if (!this.accepting || conversation.sealed) return { kind: 'rejected', reason: 'closing' }
      if (workspaceRevision !== conversation.workspaceRevision) return { kind: 'rejected', reason: 'stale_context' }
      await prepare()
      if (!this.accepting || conversation.sealed) return { kind: 'rejected', reason: 'closing' }
      if (workspaceRevision !== conversation.workspaceRevision) return { kind: 'rejected', reason: 'stale_context' }
      const lease = await this.attachRuntime({ conversationId, contextId: 'user-terminal', bindingId: 'user-terminal' })
      lease.workspaceRevision = workspaceRevision
      const env = await getShellEnv()
      const requested =
        shell === 'default'
          ? env.SHELL ||
            process.env.SHELL ||
            (process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'zsh' : 'bash')
          : shell
      const file =
        requested === 'bash'
          ? process.platform === 'win32'
            ? (autoDiscoverGitBash() ?? (await findExecutableInEnv('bash', { env })))
            : await findExecutableInEnv('bash', { env })
          : requested === 'powershell'
            ? ((await findExecutableInEnv('pwsh', { env })) ?? (await findExecutableInEnv('powershell', { env })))
            : path.isAbsolute(requested)
              ? requested
              : await findExecutableInEnv(requested, { env })
      if (!file) throw new Error('Terminal shell is unavailable')
      const name = path
        .basename(file)
        .replace(/\.exe$/i, '')
        .toLowerCase()
      const flavor =
        name === 'bash' || name === 'zsh' ? name : name === 'pwsh' || name === 'powershell' ? 'powershell' : 'other'
      const receipt = await this.start({
        lease,
        replayKey,
        turnId: replayKey,
        launch: { kind: 'pty', shell: flavor, file, args: ['-l'], cwd, env, cols: 80, rows: 24 }
      })
      if (receipt.kind !== 'resource') return receipt
      return this.mutate(
        { host: receipt.resource.host, id: receipt.resource.id },
        {
          kind: 'control',
          id: receipt.resource.id,
          actor: { kind: 'user' },
          controlRevision: receipt.resource.controlRevision,
          target: { kind: 'user' }
        },
        `create-user:${replayKey}`
      )
    } finally {
      try {
        if (usageId) await application.get('AgentWorkspaceStorageService').releaseUsage(usageId)
      } finally {
        conversation.preparations.delete(preparation.promise)
        preparation.resolve()
      }
      if (conversation.host) void this.recycle(conversation, conversation.host)
    }
  }

  private conversation(value: string): Conversation {
    const id = terminalConversationId.parse(value)
    let conversation = this.conversations.get(id)
    if (!conversation) {
      if (!this.accepting || this.conversations.size >= 1024) throw new Error('Terminal conversation capacity exceeded')
      conversation = {
        id,
        sealed: false,
        revision: 0,
        workspaceRevision: 0,
        changingWorkspace: false,
        admissions: 0,
        preparations: new Set(),
        contexts: new Map(),
        bindings: new Map(),
        executions: new Map()
      }
      this.conversations.set(id, conversation)
    }
    return conversation
  }

  async attachRuntime(input: { conversationId: string; contextId: string; bindingId: string }): Promise<TerminalLease> {
    const conversation = this.conversation(input.conversationId)
    if (!this.accepting || conversation.sealed) throw new Error('Terminal conversation is closed')
    if (!input.contextId || input.contextId.length > 512 || !input.bindingId || input.bindingId.length > 512)
      throw new Error('Invalid terminal context')
    const previous = conversation.contexts.get(input.contextId)
    if (!previous && conversation.contexts.size >= 32) throw new Error('Terminal context capacity exceeded')
    const context =
      previous?.bindingId === input.bindingId
        ? previous
        : { contextId: input.contextId, bindingId: input.bindingId, revision: (previous?.revision ?? -1) + 1 }
    conversation.contexts.set(context.contextId, context)
    if (conversation.host && conversation.host.phase !== 'closing' && conversation.host.phase !== 'lost') {
      const host = conversation.host
      await host.ready
      await this.command(conversation, host, { kind: 'bind', context })
    }
    return {
      conversationId: conversation.id,
      context: structuredClone(context),
      workspaceRevision: conversation.workspaceRevision
    }
  }

  workspaceRevision(conversationId: string): number {
    return this.conversation(conversationId).workspaceRevision
  }

  async changeWorkspace<T>(conversationId: string, commit: () => T): Promise<T> {
    const conversation = this.conversation(conversationId)
    if (conversation.sealed || conversation.changingWorkspace) throw new Error('Terminal admission is unavailable')
    conversation.changingWorkspace = true
    try {
      const host = conversation.host
      conversation.revision++
      if (host && host.phase !== 'lost' && host.phase !== 'closing') {
        await host.ready
        await host.instance.request('advanceAdmission', {
          host: host.identity,
          admissionRevision: conversation.revision
        })
        host.admissionRevision = conversation.revision
      }
      const result = commit()
      conversation.workspaceRevision++
      return result
    } finally {
      conversation.changingWorkspace = false
    }
  }

  private valid(conversation: Conversation, lease: TerminalLease): boolean {
    const context = conversation.contexts.get(lease.context.contextId)
    return (
      context !== undefined &&
      context.bindingId === lease.context.bindingId &&
      context.revision === lease.context.revision
    )
  }

  async releaseRuntime(lease: TerminalLease): Promise<void> {
    const conversation = this.conversations.get(lease.conversationId)
    if (!conversation || !this.valid(conversation, lease)) return
    conversation.contexts.set(lease.context.contextId, { ...lease.context, revision: lease.context.revision + 1 })
    const host = conversation.host
    if (host && host.phase !== 'closing' && host.phase !== 'lost') {
      await host.ready
      await this.command(conversation, host, {
        kind: 'release-context',
        context: lease.context,
        nextRevision: lease.context.revision + 1
      })
    }
  }

  start(input: {
    lease: TerminalLease
    replayKey: string
    turnId: string
    launch: TerminalLaunch
    background?: boolean
    onOutput?: Execution['onOutput']
  }): Promise<TerminalReceipt> {
    const conversation = this.conversation(input.lease.conversationId)
    const launch = terminalLaunch.parse(input.launch)
    const retention: TerminalRetention =
      launch.kind === 'pty' || input.background ? { kind: 'session' } : { kind: 'turn', turnId: input.turnId }
    if (input.background && launch.shell !== 'bash') throw new Error('PowerShell background execution is not enabled')
    if (!input.replayKey || input.replayKey.length > 512 || input.turnId.length > 512)
      throw new Error('Invalid terminal execution identity')
    const key = JSON.stringify([input.lease.context.contextId, input.replayKey])
    const signature = createHash('sha256').update(JSON.stringify({ launch, retention })).digest('hex')
    const known = conversation.bindings.get(key)
    if (known)
      return known.signature === signature
        ? known.execution.ready
        : Promise.resolve({ kind: 'rejected', reason: 'identity_conflict' })
    if (!this.accepting || conversation.sealed) return Promise.resolve({ kind: 'rejected', reason: 'closing' })
    if (
      conversation.changingWorkspace ||
      input.lease.workspaceRevision !== conversation.workspaceRevision ||
      !this.valid(conversation, input.lease)
    )
      return Promise.resolve({ kind: 'rejected', reason: 'stale_context' })
    const active = [...conversation.executions.values()].filter((item) => item.state?.cleanup !== 'confirmed')
    const globalPipes = [...this.conversations.values()].reduce(
      (count, item) =>
        count +
        [...item.executions.values()].filter(
          (execution) => execution.kind === 'pipe' && execution.state?.cleanup !== 'confirmed'
        ).length,
      0
    )
    if (
      conversation.bindings.size >= 1024 ||
      this.bindingCount >= 4096 ||
      active.filter((item) => item.kind === launch.kind).length >= 4 ||
      (launch.kind === 'pipe' && globalPipes >= 16) ||
      this.pending >= 32 ||
      conversation.admissions >= 8
    )
      return Promise.resolve({ kind: 'rejected', reason: 'capacity_exceeded' })
    const id = terminalResourceId.parse(randomUUID())
    const completion = Promise.withResolvers<TerminalReceipt>()
    const execution: Execution = {
      ref: { id, host: { conversationId: conversation.id, generation: terminalGeneration.parse(randomUUID()) } },
      kind: launch.kind,
      ...(launch.kind === 'pipe' && { toolCallId: input.replayKey }),
      output: new TerminalCapture(64 * 1024),
      ready: completion.promise,
      onOutput: input.onOutput
    }
    conversation.executions.set(id, execution)
    conversation.bindings.set(key, { signature, execution })
    this.bindingCount++
    this.pending++
    conversation.admissions++
    void (async () => {
      let host: Host | undefined
      let submitted = false
      try {
        host = await this.ensureHost(conversation)
        execution.ref.host = host.identity
        execution.state = {
          id,
          host: host.identity,
          kind: launch.kind,
          shell: launch.shell,
          context: input.lease.context,
          process: { kind: 'starting' },
          cleanup: 'none',
          retention,
          cancelRevision: 0,
          control: { kind: 'agent', context: input.lease.context },
          controlRevision: 0,
          revision: -1,
          outputCursor: 0
        }
        host.resources.add(id)
        if (
          conversation.sealed ||
          conversation.changingWorkspace ||
          input.lease.workspaceRevision !== conversation.workspaceRevision ||
          !this.valid(conversation, input.lease)
        ) {
          host.resources.delete(id)
          return { kind: 'rejected', reason: 'stale_context' } as const
        }
        execution.usageId = await application.get('AgentWorkspaceStorageService').acquireUsage({
          sessionId: conversation.id,
          cwd: launch.cwd,
          owner: { kind: 'terminal', resourceId: id, generation: host.identity.generation }
        })
        if (
          conversation.sealed ||
          conversation.changingWorkspace ||
          input.lease.workspaceRevision !== conversation.workspaceRevision ||
          !this.valid(conversation, input.lease)
        ) {
          host.resources.delete(id)
          await application.get('AgentWorkspaceStorageService').releaseUsage(execution.usageId)
          return { kind: 'rejected', reason: 'stale_context' } as const
        }
        submitted = true
        const receipt = await this.command(conversation, host, {
          kind: 'start',
          id,
          context: input.lease.context,
          retention,
          launch
        })
        if (receipt.kind === 'rejected' && receipt.reason !== 'outcome_unknown') {
          host.resources.delete(id)
          await application.get('AgentWorkspaceStorageService').releaseUsage(execution.usageId)
        }
        this.updateUsage(execution)
        return receipt
      } catch (error) {
        if (!submitted) {
          host?.resources.delete(id)
          if (execution.usageId)
            await application
              .get('AgentWorkspaceStorageService')
              .releaseUsage(execution.usageId)
              .catch((error) =>
                logger.error('Workspace protection retained after rejected startup', { error, resource: execution.ref })
              )
        } else if (execution.usageId) {
          application.get('AgentWorkspaceStorageService').markUsageUnconfirmed(execution.usageId)
        }
        logger.warn('Terminal launch could not be confirmed', {
          error,
          conversationId: conversation.id,
          resourceId: id
        })
        return { kind: 'rejected', reason: submitted ? 'outcome_unknown' : 'admission_unavailable' } as const
      } finally {
        this.pending--
        conversation.admissions--
        if (host) void this.recycle(conversation, host)
      }
    })().then((receipt) => {
      if (receipt.kind === 'resource' && (!execution.state || execution.state.revision <= receipt.resource.revision))
        execution.state = receipt.resource
      else if (!hostOwns(conversation.host, id)) conversation.executions.delete(id)
      completion.resolve(receipt)
      this.changes.fire(conversation.id)
    })
    return completion.promise
  }

  mutate(
    ref: TerminalResourceRef,
    command: Exclude<TerminalCommand, { kind: 'bind' | 'release-context' | 'start' }>,
    replayKey?: string
  ): Promise<TerminalReceipt> {
    if (!replayKey) return this.performMutation(ref, command)
    const key = JSON.stringify([ref.host.generation, ref.id, replayKey])
    const signature = createHash('sha256').update(JSON.stringify(command)).digest('hex')
    const known = this.mutations.get(key)
    if (known)
      return known.signature === signature
        ? known.receipt
        : Promise.resolve({ kind: 'rejected', reason: 'identity_conflict' })
    if (this.mutations.size >= 4096) return Promise.resolve({ kind: 'rejected', reason: 'capacity_exceeded' })
    const completion = Promise.withResolvers<TerminalReceipt>()
    this.mutations.set(key, { signature, receipt: completion.promise })
    void this.performMutation(ref, command).then(completion.resolve, completion.reject)
    return completion.promise
  }

  private async performMutation(
    ref: TerminalResourceRef,
    command: Exclude<TerminalCommand, { kind: 'bind' | 'release-context' | 'start' }>
  ): Promise<TerminalReceipt> {
    const conversation = this.conversations.get(ref.host.conversationId)
    const host = conversation?.host
    if (
      !conversation ||
      !host ||
      host.identity.generation !== ref.host.generation ||
      host.phase !== 'ready' ||
      command.id !== ref.id
    )
      return { kind: 'rejected', reason: 'stale_generation' }
    if (
      command.kind !== 'stop' &&
      (host.pending >= 8 || [...this.hosts].reduce((count, item) => count + item.pending, 0) >= 32)
    )
      return { kind: 'rejected', reason: 'capacity_exceeded' }
    return this.command(conversation, host, command)
  }

  async stopTurn(lease: TerminalLease, turnId: string): Promise<void> {
    const conversation = this.conversations.get(lease.conversationId)
    if (!conversation || !this.valid(conversation, lease)) return
    await Promise.all(
      this.list(lease.conversationId)
        .filter(
          (state) =>
            state.kind === 'pipe' &&
            state.context.contextId === lease.context.contextId &&
            state.retention.kind === 'turn' &&
            state.retention.turnId === turnId
        )
        .map((state) =>
          this.mutate(
            { host: state.host, id: state.id },
            {
              kind: 'stop',
              id: state.id,
              actor: { kind: 'agent', context: lease.context },
              cancelRevision: state.cancelRevision,
              controlRevision: state.controlRevision,
              reason: 'agent_stop'
            }
          )
        )
    )
  }

  list(conversationId: TerminalConversationId): TerminalResourceState[] {
    return [...(this.conversations.get(conversationId)?.executions.values() ?? [])].flatMap((execution) =>
      execution.state ? [structuredClone(execution.state)] : []
    )
  }

  hasActiveResources(conversationId: string): boolean {
    const conversation = this.conversations.get(terminalConversationId.parse(conversationId))
    return Boolean(
      conversation &&
      (conversation.preparations.size ||
        conversation.admissions ||
        [...conversation.executions.values()].some((item) => item.state?.cleanup !== 'confirmed'))
    )
  }

  listForView(conversationId: TerminalConversationId, selectedId?: string) {
    const all: TerminalResourceView[] = this.list(conversationId).map((resource) => ({
      ...resource,
      toolCallId: this.conversations.get(conversationId)?.executions.get(resource.id)?.toolCallId
    }))
    const priority = [
      ...all.filter((item) => item.id === selectedId),
      ...all.filter((item) => item.cleanup !== 'confirmed'),
      ...all.toReversed()
    ]
    const retained = new Set<string>()
    let bytes = 0
    for (const item of priority) {
      if (retained.has(item.id)) continue
      const size = Buffer.byteLength(JSON.stringify(item))
      if (retained.size >= 32 || bytes + size > 60 * 1024) break
      retained.add(item.id)
      bytes += size
    }
    return { resources: all.filter((item) => retained.has(item.id)), truncated: retained.size < all.length }
  }

  read(ref: TerminalResourceRef, cursor = 0, limit = 60 * 1024) {
    const execution = this.conversations.get(ref.host.conversationId)?.executions.get(ref.id)
    if (!execution || execution.ref.host.generation !== ref.host.generation)
      throw new Error('Unknown terminal resource')
    return execution.output.read(cursor, limit)
  }

  readText(ref: TerminalResourceRef, cursor = 0, limit = 60 * 1024) {
    const read = this.read(ref, cursor, limit)
    const state = this.conversations.get(ref.host.conversationId)?.executions.get(ref.id)?.state
    const final = state?.cleanup === 'confirmed' || state?.process.kind === 'lost'
    let length = read.data.length
    if (length && (read.next < read.end || !final)) {
      let start = length - 1
      while (start > 0 && (read.data[start] & 0xc0) === 0x80 && length - start < 4) start--
      const lead = read.data[start]
      const width =
        lead >= 0xf0 && lead <= 0xf4 ? 4 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xc2 && lead <= 0xdf ? 2 : 1
      if (length - start < width) length = start
    }
    return {
      start: read.start,
      next: read.start + length,
      end: read.end,
      truncated: read.truncated,
      output: Buffer.from(read.data.subarray(0, length)).toString('utf8')
    }
  }

  detachOutput(ref: TerminalResourceRef): void {
    const execution = this.conversations.get(ref.host.conversationId)?.executions.get(ref.id)
    if (execution?.ref.host.generation === ref.host.generation) execution.onOutput = undefined
  }

  async wait(
    ref: TerminalResourceRef,
    options: { signal?: AbortSignal; budgetMs?: number; commandId?: string; foreground?: boolean; prompt?: boolean },
    output?: (data: Uint8Array, truncated: boolean) => void
  ) {
    let cursor = 0
    const end = options.budgetMs === undefined ? Infinity : Date.now() + options.budgetMs
    let wake = () => {}
    const subscription = this.onDidChange((id) => {
      if (id === ref.host.conversationId) wake()
    })
    const aborted = () => wake()
    options.signal?.addEventListener('abort', aborted)
    try {
      while (true) {
        const changed = Promise.withResolvers<void>()
        wake = () => changed.resolve()
        const resource = this.list(ref.host.conversationId).find(
          (item) => item.id === ref.id && item.host.generation === ref.host.generation
        )
        if (!resource) throw new Error('Terminal execution is unavailable')
        const outputError = this.conversations.get(ref.host.conversationId)?.executions.get(ref.id)?.outputError
        if (outputError) throw outputError
        const read = this.read(ref, cursor)
        cursor = read.next
        if (read.data.length || read.truncated) output?.(read.data, read.truncated)
        if (cursor < read.end) continue
        if (options.prompt && resource.shellFacts?.kind === 'prompt') return { status: 'ended' as const, resource }
        if (resource.control.kind === 'user' || resource.control.kind === 'unassigned')
          return { status: 'control_transferred' as const, resource }
        if (
          resource.process.kind === 'exited' ||
          resource.process.kind === 'lost' ||
          resource.process.kind === 'not_started'
        )
          if (
            cursor >= resource.outputCursor &&
            (resource.kind === 'pty' || resource.cleanup === 'confirmed' || resource.cleanup === 'unconfirmed')
          )
            return { status: 'ended' as const, resource }
        if (options.commandId && resource.command?.id === options.commandId && resource.command.status !== 'running')
          return { status: 'ended' as const, resource }
        if (options.signal?.aborted) {
          if (resource.kind === 'pipe' && resource.retention.kind === 'turn')
            await this.stopTurn(
              {
                conversationId: ref.host.conversationId,
                context: resource.context,
                workspaceRevision: this.workspaceRevision(ref.host.conversationId)
              },
              resource.retention.turnId
            )
          return { status: 'cancelled' as const, resource }
        }
        if (Date.now() >= end || (options.foreground && resource.retention.kind === 'session'))
          return { status: 'running' as const, resource }
        const timer = setTimeout(wake, Math.min(1000, Math.max(1, end - Date.now())))
        try {
          await changed.promise
        } finally {
          clearTimeout(timer)
        }
      }
    } finally {
      subscription.dispose()
      options.signal?.removeEventListener('abort', aborted)
    }
  }

  openView(ref: TerminalResourceRef, owner: WindowId): string {
    if (
      !this.list(ref.host.conversationId).some(
        (item) => item.id === ref.id && item.host.generation === ref.host.generation
      )
    )
      throw new Error('Unknown terminal resource')
    if (this.views.size >= 32 || [...this.views.values()].filter((view) => view.ref.id === ref.id).length >= 4)
      throw new Error('Terminal view capacity exceeded')
    const window = application.get('WindowManager').getWindow(owner)
    if (!window || window.isDestroyed()) throw new Error('Terminal view requires an app window')
    if (!this.windows.has(owner)) {
      this.windows.add(owner)
      const closed = () => {
        this.windows.delete(owner)
        for (const [id, view] of this.views)
          if (view.owner === owner)
            void this.closeView(id, owner).catch((error: unknown) =>
              logger.warn('Failed to detach closed terminal view', { error })
            )
      }
      window.once('closed', closed)
      this.registerDisposable(() => window.removeListener('closed', closed))
    }
    const id = randomUUID()
    this.views.set(id, { owner, ref, pending: false, offset: 0 })
    return id
  }

  private ownedView(viewId: string, owner: WindowId) {
    const view = this.views.get(viewId)
    if (!view || view.owner !== owner) throw new Error('Stale terminal view')
    return view
  }

  async viewFrame(
    viewId: string,
    owner: WindowId,
    rowStart: number,
    offset: number,
    revision: number | null,
    theme?: GhosttyTheme
  ): Promise<TerminalViewFrame> {
    const view = this.ownedView(viewId, owner)
    if (view.pending) throw new Error('Terminal view request is already pending')
    view.pending = true
    try {
      const conversation = this.conversations.get(view.ref.host.conversationId)
      const execution = conversation?.executions.get(view.ref.id)
      if (execution?.screen) {
        const frame = execution.screen.find((item) => item.rowStart === rowStart)
        if (!frame) throw new Error('Invalid retained terminal screen cursor')
        return {
          ...frame,
          viewId,
          controlling: false,
          resource: structuredClone(execution.state!),
          snapshot: { ...frame.snapshot, cursorVisible: false }
        }
      }
      const host = conversation?.host
      if (!host || host.identity.generation !== view.ref.host.generation || host.phase !== 'ready')
        throw new Error('Terminal Host is unavailable')
      const frame = await host.instance.request('view', { ...view.ref, viewId, rowStart, offset, revision, theme })
      view.offset = frame.scrollOffset
      return { ...frame, controlling: this.controllingViews.get(view.ref.id) === viewId }
    } finally {
      view.pending = false
    }
  }

  async viewCommand(
    viewId: string,
    owner: WindowId,
    operationId: string,
    command: Exclude<TerminalCommand, { kind: 'bind' | 'release-context' | 'start' | 'promote' | 'shell-command' }>
  ) {
    const view = this.ownedView(viewId, owner)
    if (command.id !== view.ref.id || !('actor' in command) || command.actor.kind !== 'user')
      throw new Error('Invalid terminal view command')
    if (
      ['resize', 'key', 'paste', 'mouse', 'wheel', 'input'].includes(command.kind) &&
      this.controllingViews.get(command.id) !== viewId
    )
      return { kind: 'rejected' as const, reason: 'stale_control' as const }
    if ((command.kind === 'mouse' || command.kind === 'wheel') && view.offset !== 0)
      return { kind: 'rejected' as const, reason: 'stale_control' as const }
    const result = await this.mutate(view.ref, command, `${viewId}:${operationId}`)
    if (result.kind === 'resource' && command.kind === 'control') {
      if (result.resource.control.kind === 'user') this.controllingViews.set(command.id, viewId)
      else this.controllingViews.delete(command.id)
    }
    return result
  }

  async userAction(
    viewId: string,
    owner: WindowId,
    operationId: string,
    controlRevision: number,
    action: z.infer<typeof terminalViewAction>
  ): Promise<TerminalReceipt> {
    const view = this.ownedView(viewId, owner)
    const state = this.list(view.ref.host.conversationId).find((item) => item.id === view.ref.id)
    if (!state) throw new Error('Unknown terminal resource')
    const common = { id: state.id, actor: { kind: 'user' as const }, controlRevision }
    if (action.kind === 'take-control' || action.kind === 'return-control')
      return this.viewCommand(viewId, owner, operationId, {
        ...common,
        kind: 'control',
        target: { kind: action.kind === 'take-control' ? 'user' : 'unassigned' }
      })
    if (action.kind === 'stop')
      return this.viewCommand(viewId, owner, operationId, {
        ...common,
        kind: 'stop',
        cancelRevision: state.cancelRevision,
        reason: 'user'
      })
    return this.viewCommand(viewId, owner, operationId, { ...action, ...common })
  }

  async closeView(viewId: string, owner: WindowId): Promise<void> {
    const view = this.ownedView(viewId, owner)
    this.views.delete(viewId)
    if (this.controllingViews.get(view.ref.id) === viewId) this.controllingViews.delete(view.ref.id)
    const host = this.conversations.get(view.ref.host.conversationId)?.host
    if (host?.identity.generation === view.ref.host.generation && host.phase === 'ready')
      await host.instance.request('detachView', { ...view.ref, viewId })
  }

  async viewLink(
    viewId: string,
    owner: WindowId,
    input: { revision: number; geometryEpoch: number; x: number; y: number }
  ): Promise<string | null> {
    const view = this.ownedView(viewId, owner)
    const host = this.conversations.get(view.ref.host.conversationId)?.host
    if (!host || host.phase !== 'ready' || host.identity.generation !== view.ref.host.generation) return null
    return host.instance.request('link', { ...view.ref, viewId, ...input })
  }

  private updateUsage(execution: Execution): void {
    if (!execution.usageId) return
    if (execution.state?.cleanup === 'unconfirmed' || execution.state?.process.kind === 'lost')
      application.get('AgentWorkspaceStorageService').markUsageUnconfirmed(execution.usageId)
    if (execution.state?.cleanup !== 'confirmed') return
    const id = execution.usageId
    execution.usageId = undefined
    void application
      .get('AgentWorkspaceStorageService')
      .releaseUsage(id)
      .catch((error) => {
        logger.error('Workspace protection retained after terminal cleanup', { error, resource: execution.ref })
      })
  }

  private async command(conversation: Conversation, host: Host, command: TerminalCommand): Promise<TerminalReceipt> {
    const sequence = ++host.sequence
    const admissionRevision = conversation.revision
    if ((command.kind === 'bind' || command.kind === 'start') && host.admissionRevision !== admissionRevision) {
      await host.instance.request('advanceAdmission', { host: host.identity, admissionRevision })
      host.admissionRevision = Math.max(host.admissionRevision, admissionRevision)
    }
    const mutation: TerminalMutation = {
      host: host.identity,
      admissionRevision,
      operation: { id: terminalOperationId.parse(`${host.identity.generation}:${sequence}`), sequence },
      command
    }
    host.pending++
    try {
      let receipt: TerminalReceipt
      try {
        receipt = await host.instance.request('mutate', mutation)
      } catch {
        const outcome = await host.instance.request('operation', { host: host.identity, id: mutation.operation.id })
        if (outcome.kind !== 'settled') return { kind: 'rejected', reason: 'outcome_unknown' }
        receipt = outcome.receipt
      }
      if (receipt.kind === 'resource') {
        const execution = conversation.executions.get(receipt.resource.id)
        if (execution && (!execution.state || execution.state.revision <= receipt.resource.revision))
          execution.state = receipt.resource
        if (execution) this.updateUsage(execution)
        this.changes.fire(conversation.id)
      }
      return receipt
    } finally {
      host.pending--
      void this.recycle(conversation, host)
    }
  }

  private async ensureHost(conversation: Conversation): Promise<Host> {
    while (conversation.host) {
      const previous = conversation.host
      if (previous.phase === 'closing' || previous.phase === 'lost') {
        await previous.retirement
        if (conversation.host === previous) throw new Error('Previous terminal Host exit remains unconfirmed')
      } else {
        await previous.ready
        if (conversation.host === previous && previous.phase === 'ready') return previous
      }
    }
    if (!this.accepting || conversation.sealed) throw new Error('Terminal conversation is closed')
    if (this.hosts.size >= 8) throw new Error('Terminal Host capacity exceeded')
    const identity = { conversationId: conversation.id, generation: terminalGeneration.parse(randomUUID()) }
    const instance = application.get('UtilityProcessManager').createInstance(definition, {
      restart: 'never',
      createInitData: () => ({
        host: identity,
        admissionRevision: conversation.revision,
        helperFile: application.getPath('feature.terminal.scope_helper_file'),
        ghosttyDirectory: application.getPath('feature.terminal.ghostty'),
        integrationDirectory: application.getPath('feature.terminal.integration')
      })
    })
    const host: Host = {
      identity,
      instance,
      ready: Promise.resolve(),
      sequence: 0,
      admissionRevision: conversation.revision,
      pending: 0,
      resources: new Set(),
      phase: 'starting',
      observer: new AbortController()
    }
    conversation.host = host
    this.hosts.add(host)
    host.ready = (async () => {
      const actual = await instance.request('identity', undefined)
      if (actual.generation !== identity.generation || actual.conversationId !== identity.conversationId)
        throw new Error('Terminal Host identity mismatch')
      const stream = await instance.openStream('observe', identity, {
        signal: host.observer.signal,
        input: limits,
        output: limits
      })
      void stream.completed.catch(() => {})
      void (async () => {
        try {
          for await (const frame of stream.output) {
            const id = terminalResourceId.parse(frame.metadata.id)
            const execution = conversation.executions.get(id)
            if (!execution || execution.ref.host.generation !== identity.generation || conversation.host !== host)
              continue
            if (frame.metadata.kind === 'output' && frame.payload) {
              const start = Number(frame.metadata.start)
              const gap = start !== execution.output.cursor || frame.metadata.truncated === true
              if (start !== execution.output.cursor) execution.output.reset(start)
              execution.output.append(frame.payload)
              try {
                execution.onOutput?.(
                  frame.payload,
                  gap,
                  frame.metadata.source === 'stderr'
                    ? 'stderr'
                    : frame.metadata.source === 'stdout'
                      ? 'stdout'
                      : 'terminal'
                )
              } catch (error) {
                execution.outputError = error
                execution.onOutput = undefined
              }
            } else if (frame.metadata.kind === 'state' && frame.payload) {
              const state = JSON.parse(Buffer.from(frame.payload).toString('utf8')) as TerminalResourceState
              if (state.host.generation !== identity.generation || state.id !== id)
                throw new Error('Terminal observation identity mismatch')
              if (!execution.state || execution.state.revision <= state.revision) execution.state = state
              this.updateUsage(execution)
              if (state.cleanup === 'confirmed' && state.outputCursor === execution.output.cursor) {
                if (state.kind === 'pty' && !execution.screen) {
                  try {
                    const frames: TerminalViewFrame[] = []
                    let rowStart = 0
                    let bytes = 0
                    while (true) {
                      const frame = await instance.request('view', {
                        host: identity,
                        id,
                        viewId: 'retained-final',
                        rowStart,
                        offset: 0,
                        revision: null
                      })
                      bytes += Buffer.byteLength(JSON.stringify(frame))
                      if (bytes > 1024 * 1024 || this.screenBytes + bytes > 32 * 1024 * 1024)
                        throw new Error('Retained terminal screen capacity exceeded')
                      frames.push(frame)
                      if (frame.complete) break
                      rowStart += frame.rowIndices.length
                    }
                    execution.screen = frames
                    this.screenBytes += bytes
                  } catch (error) {
                    logger.warn('Final terminal screen could not be retained', { error, resourceId: id })
                  }
                  execution.state = { ...state, screenAvailable: Boolean(execution.screen) }
                }
                if (await instance.request('release', { host: identity, id })) {
                  host.resources.delete(id)
                  void this.recycle(conversation, host)
                }
              }
            }
            this.changes.fire(conversation.id)
          }
          if (host.phase === 'ready') throw new Error('Terminal observation ended unexpectedly')
        } catch (error) {
          if (!host.observer.signal.aborted) this.lost(conversation, host, error)
        }
      })()
      for (const context of conversation.contexts.values())
        await this.command(conversation, host, { kind: 'bind', context })
      if (host.phase === 'starting') host.phase = 'ready'
    })().catch((error: unknown) => {
      this.lost(conversation, host, error)
      throw error
    })
    await host.ready
    return host
  }

  private lost(conversation: Conversation, host: Host, error: unknown): void {
    if (host.phase === 'closing' || host.phase === 'lost') return
    host.phase = 'lost'
    for (const id of host.resources) {
      const execution = conversation.executions.get(id)
      if (execution?.state?.cleanup === 'confirmed') continue
      if (execution?.state)
        execution.state = {
          ...execution.state,
          process:
            execution.state.process.kind === 'exited'
              ? execution.state.process
              : { kind: 'lost', message: 'Terminal Host disconnected' },
          cleanup: 'unconfirmed',
          revision: execution.state.revision + 1
        }
    }
    for (const execution of conversation.executions.values()) this.updateUsage(execution)
    logger.error('Terminal Host lost; cleanup remains unconfirmed', { error, host: host.identity })
    this.changes.fire(conversation.id)
    host.retirement = this.retire(conversation, host)
  }

  private async recycle(conversation: Conversation, host: Host): Promise<void> {
    if (
      host.phase !== 'ready' ||
      host.resources.size ||
      host.pending ||
      conversation.admissions ||
      conversation.preparations.size
    )
      return
    host.phase = 'closing'
    host.retirement = this.retire(conversation, host)
    await host.retirement
  }

  private async retire(conversation: Conversation, host: Host): Promise<void> {
    host.observer.abort()
    try {
      await host.instance.stop()
      await host.instance.dispose()
      this.hosts.delete(host)
      if (conversation.host === host) conversation.host = undefined
    } catch (error) {
      logger.error('Terminal Host exit remains unconfirmed', { error, host: host.identity })
    }
  }

  async reopenConversation(conversationId: TerminalConversationId): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation?.sealed) return
    if (this.hasActiveResources(conversationId)) throw new Error('Terminal cleanup remains unconfirmed')
    const host = conversation.host
    if (host) {
      if (host.resources.size) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            listener.dispose()
            reject(new Error('Terminal output drain remains pending'))
          }, 5000)
          const listener = this.onDidChange((id) => {
            if (id === conversationId && !host.resources.size) {
              clearTimeout(timer)
              listener.dispose()
              resolve()
            }
          })
        })
      }
      await this.recycle(conversation, host)
      await host.retirement
      if (conversation.host === host) throw new Error('Terminal Host exit remains unconfirmed')
    }
    for (const [id, context] of conversation.contexts)
      conversation.contexts.set(id, { ...context, revision: context.revision + 1 })
    conversation.revision++
    conversation.sealed = false
  }

  async closeConversation(conversationId: TerminalConversationId): Promise<TerminalResourceState[]> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) return []
    conversation.sealed = true
    conversation.revision++
    const host = conversation.host
    if (host && host.phase !== 'lost' && host.phase !== 'closing') {
      try {
        await host.ready
        const states = await host.instance.request('seal', {
          host: host.identity,
          admissionRevision: conversation.revision
        })
        for (const state of states) {
          const execution = conversation.executions.get(state.id)
          if (execution && (!execution.state || execution.state.revision <= state.revision)) execution.state = state
        }
      } catch (error) {
        this.lost(conversation, host, error)
      }
    }
    await Promise.all(conversation.preparations)
    await Promise.all([...conversation.executions.values()].map((execution) => execution.ready))
    return this.list(conversationId)
  }

  protected async onStop(): Promise<void> {
    this.accepting = false
    await Promise.all([...this.conversations.keys()].map((id) => this.closeConversation(id)))
    const uncertain = [...this.conversations.values()]
      .flatMap((conversation) => [...conversation.executions.values()])
      .filter((execution) => execution.state?.cleanup !== 'confirmed')
    if (uncertain.length) logger.error('Terminal shutdown has unconfirmed scopes', { count: uncertain.length })
    await Promise.all(
      [...this.hosts].map((host) => {
        const conversation = this.conversations.get(host.identity.conversationId)!
        return this.retire(conversation, host)
      })
    )
  }
}

function hostOwns(host: Host | undefined, id: TerminalResourceId): boolean {
  return host?.resources.has(id) ?? false
}
