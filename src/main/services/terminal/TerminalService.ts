import { createHash, randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessInstance } from '@main/core/utilityProcess/types'

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
}
export interface TerminalResourceRef {
  host: TerminalHostIdentity
  id: TerminalResourceId
}
interface Execution {
  ref: TerminalResourceRef
  kind: TerminalLaunch['kind']
  state?: TerminalResourceState
  output: TerminalCapture
  ready: Promise<TerminalReceipt>
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
  admissions: number
  contexts: Map<string, TerminalContext>
  bindings: Map<string, Binding>
  executions: Map<TerminalResourceId, Execution>
  host?: Host
}

@Injectable('TerminalService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['UtilityProcessManager'])
export class TerminalService extends BaseService {
  private readonly conversations = new Map<TerminalConversationId, Conversation>()
  private readonly hosts = new Set<Host>()
  private accepting = true
  private bindingCount = 0
  private pending = 0

  protected onInit(): void {
    application.get('UtilityProcessManager').register(definition)
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
        admissions: 0,
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
    return { conversationId: conversation.id, context: structuredClone(context) }
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
    if (!this.valid(conversation, input.lease)) return Promise.resolve({ kind: 'rejected', reason: 'stale_context' })
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
      output: new TerminalCapture(64 * 1024),
      ready: completion.promise
    }
    conversation.executions.set(id, execution)
    conversation.bindings.set(key, { signature, execution })
    this.bindingCount++
    this.pending++
    conversation.admissions++
    void (async () => {
      let host: Host | undefined
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
        if (conversation.sealed || !this.valid(conversation, input.lease)) {
          host.resources.delete(id)
          return { kind: 'rejected', reason: 'stale_context' } as const
        }
        const receipt = await this.command(conversation, host, {
          kind: 'start',
          id,
          context: input.lease.context,
          retention,
          launch
        })
        if (receipt.kind === 'rejected' && receipt.reason !== 'outcome_unknown') host.resources.delete(id)
        return receipt
      } catch (error) {
        logger.warn('Terminal launch could not be confirmed', {
          error,
          conversationId: conversation.id,
          resourceId: id
        })
        return { kind: 'rejected', reason: 'outcome_unknown' } as const
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
    })
    return completion.promise
  }

  async mutate(
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

  read(ref: TerminalResourceRef, cursor = 0, limit = 60 * 1024) {
    const execution = this.conversations.get(ref.host.conversationId)?.executions.get(ref.id)
    if (!execution || execution.ref.host.generation !== ref.host.generation)
      throw new Error('Unknown terminal resource')
    return execution.output.read(cursor, limit)
  }

  private async command(conversation: Conversation, host: Host, command: TerminalCommand): Promise<TerminalReceipt> {
    const sequence = ++host.sequence
    const mutation: TerminalMutation = {
      host: host.identity,
      admissionRevision: conversation.revision,
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
        helperFile: application.getPath('feature.terminal.scope_helper_file'),
        ghosttyDirectory: application.getPath('feature.terminal.ghostty')
      })
    })
    const host: Host = {
      identity,
      instance,
      ready: Promise.resolve(),
      sequence: 0,
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
              if (start !== execution.output.cursor) execution.output.reset(start)
              execution.output.append(frame.payload)
            } else if (frame.metadata.kind === 'state' && frame.payload) {
              const state = JSON.parse(Buffer.from(frame.payload).toString('utf8')) as TerminalResourceState
              if (state.host.generation !== identity.generation || state.id !== id)
                throw new Error('Terminal observation identity mismatch')
              if (!execution.state || execution.state.revision <= state.revision) execution.state = state
              if (
                state.cleanup === 'confirmed' &&
                state.outputCursor === execution.output.cursor &&
                (await instance.request('release', { host: identity, id }))
              ) {
                host.resources.delete(id)
                void this.recycle(conversation, host)
              }
            }
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
    logger.error('Terminal Host lost; cleanup remains unconfirmed', { error, host: host.identity })
    host.retirement = this.retire(conversation, host)
  }

  private async recycle(conversation: Conversation, host: Host): Promise<void> {
    if (host.phase !== 'ready' || host.resources.size || host.pending || conversation.admissions) return
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
