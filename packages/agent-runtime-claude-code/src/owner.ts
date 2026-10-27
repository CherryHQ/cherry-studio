import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'

import {
  runtimeId,
  type BusyPolicy,
  type InputFact,
  type InputId,
  type InputState,
  type ItemRef,
  type ObservationPayload,
  type OperationResult,
  type ShutdownReceipt,
  type SubmitResult
} from '@cherrystudio/agent-runtime'

import { readArchive } from './archive'
import { claudeThread, isCommandLifecycle, isUuid, rejected, runtimeError } from './identity'
import { ClaudeProjection } from './projection'
import type {
  ClaudeArchive,
  ClaudeCodeRuntimeOptions,
  ClaudeCommandLifecycle,
  ClaudeSessionOptions,
  ClaudeThreadHandle
} from './types'

interface Task {
  sessionId: string
  agent: boolean
  parentId?: string | null
  runId?: string
  terminal?: boolean
}
interface Input {
  uuid: string
  projection: ClaudeProjection
  state: InputState & { inputId: InputId }
  message: SDKUserMessage
  resolve: (result: SubmitResult) => void
}

export class ClaudeOwner {
  readonly projections = new Map<string, ClaudeProjection>()
  private readonly tasks = new Map<string, Task>()
  private readonly toolOwners = new Map<string, ClaudeProjection>()
  private readonly inputs = new Map<string, Input>()
  private readonly logicalInputs = new Set<InputId>()
  private readonly queue: Input[] = []
  private wake?: () => void
  private sdk?: Query
  private pump?: Promise<void>
  private exited = false
  private drained = false
  private exit?: Promise<void>
  private closing = false
  private lost = false
  private resetFrom?: string
  private activeSession: string
  private response?: ItemRef
  private readonly archives = new Map<string, ClaudeArchive>()
  private reading?: Promise<void>
  private buffered?: SDKMessage[]

  constructor(
    private readonly runtime: ClaudeCodeRuntimeOptions,
    private readonly config: ClaudeSessionOptions,
    sessionId: string,
    private readonly fresh: boolean,
    private readonly report: (error: unknown) => void,
    private readonly bind: (sessionId: string) => void
  ) {
    this.activeSession = sessionId
    this.projection(sessionId)
  }

  projection(sessionId: string, agentId?: string): ClaudeProjection {
    const thread = claudeThread(this.runtime.backendId, sessionId, agentId)
    let projection = this.projections.get(thread.id)
    if (!projection) {
      projection = new ClaudeProjection(thread, this.report)
      this.projections.set(thread.id, projection)
    }
    return projection
  }

  private async *inputStream(): AsyncGenerator<SDKUserMessage> {
    while (!this.closing && !this.lost) {
      const input = this.queue.shift()
      if (!input) {
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
        continue
      }
      if (input.projection.thread.id !== this.activeSession || this.resetFrom) {
        input.resolve({ ...rejected('submit', 'closed'), inputId: input.state.inputId })
        continue
      }
      this.inputFacts(input, ['dispatch-started'])
      input.resolve({
        status: 'acknowledged',
        inputId: input.state.inputId,
        nativeInput: input.state.nativeInput,
        facts: input.state.facts
      })
      yield input.message
    }
  }

  connect(
    projection: ClaudeProjection,
    warm?: Parameters<ClaudeThreadHandle['claude']['start']>[0]
  ): OperationResult<void> {
    if (this.closing || this.lost || this.resetFrom || projection.thread.id !== this.activeSession)
      return rejected('start', 'closed')
    if (warm && this.sdk) return rejected('start', 'already-started')
    try {
      this.start(warm)
      return { status: 'confirmed', value: undefined }
    } catch (error) {
      this.report(error)
      return rejected('start', 'native-start-failed')
    }
  }

  async control<T>(
    projection: ClaudeProjection,
    operation: string,
    invoke: (query: Query) => Promise<T>
  ): Promise<OperationResult<T>> {
    const started = this.connect(projection)
    if (started.status !== 'confirmed') return rejected(operation, 'closed')
    try {
      return { status: 'confirmed', value: await invoke(this.sdk!) }
    } catch (error) {
      this.report(error)
      return { status: 'unknown', error: runtimeError(operation, 'native-error') }
    }
  }

  private start(warm?: Parameters<ClaudeThreadHandle['claude']['start']>[0]): void {
    if (this.sdk) return
    const nativeSpawn = this.config.spawnClaudeCodeProcess
    if (warm)
      this.exit = warm.exited.then(() => {
        this.exited = true
      })
    this.sdk = warm
      ? warm.query.query(this.inputStream())
      : query({
          prompt: this.inputStream(),
          options: {
            ...this.config,
            env: { ...this.config.env, CLAUDE_CONFIG_DIR: this.runtime.configDir },
            permissionMode: this.config.permissionMode ?? 'default',
            sessionId: this.fresh ? this.activeSession : undefined,
            resume: this.fresh ? undefined : this.activeSession,
            persistSession: true,
            includePartialMessages: true,
            forwardSubagentText: true,
            spawnClaudeCodeProcess: (options) => {
              const child = nativeSpawn
                ? nativeSpawn(options)
                : spawn(options.command, options.args, {
                    cwd: options.cwd,
                    env: options.env,
                    signal: options.signal,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true
                  })
              if (!nativeSpawn && 'stderr' in child) {
                const stderr = child.stderr as NodeJS.ReadableStream
                stderr.on('data', (data: Buffer) => this.config.stderr?.(data.toString()))
              }
              this.exit = new Promise<void>((resolve) => {
                const finish = () => {
                  this.exited = true
                  resolve()
                }
                if (child.exitCode !== null || child.signalCode) finish()
                else child.once('exit', finish)
              })
              return child
            }
          }
        })
    this.pump = (async () => {
      try {
        for await (const message of this.sdk!) {
          if (this.buffered) this.buffered.push(message)
          else this.consume(message)
        }
      } catch (error) {
        if (!this.closing) this.report(error)
      } finally {
        this.lost = true
        this.wake?.()
        if (this.reading) await this.reading.catch(this.report)
        this.failPending()
        this.drained = true
        if (!this.closing) {
          for (const projection of this.projections.values()) {
            projection.publish([
              { type: 'gap', reason: 'disconnected' },
              { type: 'activity.changed', activity: { scope: 'foreground', state: 'unknown' } }
            ])
            projection.feed.close('source-lost')
          }
        }
      }
    })()
  }

  submit(
    projection: ClaudeProjection,
    inputId: InputId,
    content: SDKUserMessage['message']['content'],
    policy: BusyPolicy
  ): Promise<SubmitResult> {
    const refuse = (code: string, status: 'rejected' | 'unsupported' = 'rejected'): Promise<SubmitResult> =>
      Promise.resolve({ status, inputId, error: runtimeError('submit', code) })
    if (this.closing || this.lost || this.resetFrom || projection.thread.id !== this.activeSession)
      return refuse('closed')
    if (policy !== 'steer' && policy !== 'follow-up') return refuse('busy-policy', 'unsupported')
    if (this.logicalInputs.has(inputId)) return refuse('duplicate-input')
    if (typeof content === 'string' ? !content.trim() : !content.length) return refuse('empty-input')
    try {
      this.start()
    } catch (error) {
      this.report(error)
      return refuse('native-start-failed')
    }
    const uuid = isUuid(inputId) ? inputId : randomUUID()
    this.logicalInputs.add(inputId)
    return new Promise<SubmitResult>((resolve) => {
      const input: Input = {
        uuid,
        projection,
        resolve,
        state: { inputId, nativeInput: { session: projection.thread, id: runtimeId<'native-input'>(uuid) }, facts: [] },
        message: {
          type: 'user',
          uuid,
          message: { role: 'user', content: structuredClone(content) },
          priority: policy === 'steer' ? 'next' : 'later',
          parent_tool_use_id: null,
          session_id: this.activeSession
        }
      }
      this.inputs.set(uuid, input)
      this.queue.push(input)
      projection.publish([{ type: 'input.changed', input: input.state }])
      this.wake?.()
    })
  }

  private inputFacts(
    input: Input,
    facts: readonly InputFact[],
    terminal?: Pick<InputState, 'outcome' | 'response' | 'error'>
  ): ObservationPayload {
    input.state = { ...input.state, facts: [...new Set([...input.state.facts, ...facts])], ...terminal }
    const event: ObservationPayload = { type: 'input.changed', input: input.state }
    input.projection.publish([event])
    return event
  }

  private failPending(): void {
    for (const input of this.queue.splice(0))
      input.resolve({ ...rejected('submit', 'not-dispatched'), inputId: input.state.inputId })
    for (const input of this.inputs.values()) {
      if (!input.state.outcome)
        this.inputFacts(input, [], {
          error: runtimeError(
            'submit',
            input.state.facts.includes('dispatch-started') ? 'delivery-unknown' : 'not-dispatched'
          )
        })
    }
  }

  private relation(id: string, task: Task): void {
    if (!task.agent || task.parentId === undefined) return
    const parent = this.projection(task.sessionId, task.parentId ?? undefined)
    const child = this.projection(task.sessionId, id)
    parent.publish([
      {
        type: 'subagent.upsert',
        subagent: { id: runtimeId<'subagent'>(id), parent: parent.thread, child: child.thread }
      }
    ])
  }

  private consumeTask(message: Extract<SDKMessage, { type: 'system' }>): boolean {
    if (message.subtype === 'background_tasks_changed') {
      for (const native of message.tasks) {
        if (this.tasks.has(native.task_id)) continue
        const task: Task = {
          sessionId: this.activeSession,
          agent: native.task_type === 'local_agent',
          runId: native.run_id,
          parentId: native.parent_task_id
        }
        this.tasks.set(native.task_id, task)
        if (task.agent) this.projection(task.sessionId, native.task_id)
        this.relation(native.task_id, task)
      }
      return false
    }
    if (!('task_id' in message)) return false
    let task = this.tasks.get(message.task_id)
    if (task?.runId && message.run_id && message.run_id < task.runId) return true
    const newRun = message.run_id !== undefined && message.run_id !== task?.runId
    if (task && newRun) task.terminal = false
    if (message.subtype === 'task_started') {
      const callOwner = message.tool_use_id ? this.toolOwners.get(message.tool_use_id) : undefined
      const callAgent = callOwner?.thread.id.split('/')[1]
      task ??= { sessionId: this.activeSession, agent: message.task_type === 'local_agent' }
      task.agent ||= message.task_type === 'local_agent'
      if (task.parentId === undefined)
        task.parentId =
          message.parent_task_id ??
          (message.spawn_depth === 1
            ? null
            : callOwner
              ? callAgent
                ? decodeURIComponent(callAgent)
                : null
              : undefined)
      this.tasks.set(message.task_id, task)
      this.relation(message.task_id, task)
    }
    if (!task) return false
    if (message.run_id) task.runId = message.run_id
    const child = task.agent ? this.projection(task.sessionId, message.task_id) : undefined
    const events: ObservationPayload[] = []
    if (message.subtype === 'task_started' || message.subtype === 'task_progress') {
      if (!task.terminal) events.push({ type: 'activity.changed', activity: { scope: 'foreground', state: 'active' } })
    } else if (
      message.subtype === 'task_notification' ||
      (message.subtype === 'task_updated' && ['completed', 'failed', 'killed'].includes(message.patch.status ?? ''))
    ) {
      task.terminal = true
      events.push({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
    }
    child?.publish(events, { source: 'live', message })
    return false
  }

  private consume(message: SDKMessage | ClaudeCommandLifecycle): void {
    if (isCommandLifecycle(message)) {
      const input = this.inputs.get(message.command_uuid)
      if (input) {
        if (message.state === 'queued') this.inputFacts(input, ['accepted', 'queued'])
        else if (message.state === 'started') this.inputFacts(input, ['accepted'])
        input.projection.publish([], { source: 'live', message })
      }
      return
    }
    if (message.type === 'conversation_reset') {
      this.resetFrom = this.activeSession
      this.projection(this.activeSession).publish([{ type: 'gap', reason: 'mapping-reset' }], {
        source: 'live',
        message
      })
      this.response = undefined
      return
    }
    if (
      this.resetFrom &&
      ((message.type === 'system' && message.subtype === 'init') ||
        (message.type === 'result' && 'local_command' in message))
    ) {
      if (isUuid(message.session_id) && message.session_id !== this.resetFrom) {
        const old = this.projection(this.resetFrom)
        this.activeSession = message.session_id
        this.bind(message.session_id)
        this.projection(message.session_id)
        this.resetFrom = undefined
        old.publish([], { source: 'live', message })
      }
    }
    if (message.type === 'system' && this.consumeTask(message)) return
    const agentId = 'agent_id' in message ? message.agent_id : undefined
    const task = agentId ? this.tasks.get(agentId) : undefined
    const root = this.projection(task?.sessionId ?? this.activeSession)
    const commandInput =
      message.type === 'result' && 'local_command' in message && message.user_message_uuid
        ? this.inputs.get(message.user_message_uuid)
        : undefined
    const projection =
      commandInput?.projection ?? (agentId ? this.projection(task?.sessionId ?? this.activeSession, agentId) : root)
    if (!agentId && 'parent_tool_use_id' in message && message.parent_tool_use_id) {
      root.publish([{ type: 'gap', reason: 'mapping-reset' }])
      return
    }
    const events: ObservationPayload[] = []
    if (message.type === 'assistant') {
      events.push(...projection.remove(message.supersedes ?? []))
      events.push(...projection.message(message, { live: !agentId, aborted: message.aborted }))
      for (const block of message.message.content)
        if (block.type === 'tool_use') this.toolOwners.set(block.id, projection)
      if (!agentId) this.response = events.findLast((event) => event.type === 'item.upsert')?.item.ref ?? this.response
    } else if (message.type === 'user' && message.uuid) {
      events.push(
        ...projection.message(
          { ...message, uuid: message.uuid },
          { inputId: this.inputs.get(message.uuid)?.state.inputId }
        )
      )
    } else if (message.type === 'stream_event') {
      events.push(...projection.partial(message))
    } else if (message.type === 'system' && message.subtype === 'model_refusal_fallback') {
      for (const target of this.projections.values())
        target.publish(target.remove(message.retracted_message_uuids ?? []))
    } else if (message.type === 'system' && message.subtype === 'compact_boundary') {
      events.push({ type: 'gap', reason: 'mapping-reset' })
    } else if (message.type === 'result') {
      events.push({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
    }
    if (message.type !== 'result') projection.publish(events, { source: 'live', message })
    if (message.type === 'assistant' || message.type === 'stream_event' || message.type === 'result') {
      for (const uuid of message.user_message_uuids ?? (message.user_message_uuid ? [message.user_message_uuid] : [])) {
        const input = this.inputs.get(uuid)
        if (!input) continue
        if (message.type !== 'result') this.inputFacts(input, ['placed'])
        else {
          const local = 'local_command' in message && !!message.local_command
          const outcome =
            message.terminal_reason === 'aborted_streaming' || message.terminal_reason === 'aborted_tools'
              ? 'aborted'
              : message.is_error || message.subtype !== 'success'
                ? 'failed'
                : local || message.stop_reason === 'end_turn' || message.terminal_reason === 'completed'
                  ? 'completed'
                  : 'unanswered'
          this.inputFacts(input, local ? ['locally-handled'] : ['placed'], {
            outcome,
            response: local ? undefined : this.response,
            error: outcome === 'failed' ? runtimeError('submit', 'native-result-error') : undefined
          })
        }
      }
      if (message.type === 'result') {
        projection.publish(events, { source: 'live', message })
        this.response = undefined
      }
    }
  }

  async interrupt(projection: ClaudeProjection) {
    if (this.closing || this.lost || this.resetFrom || projection.thread.id !== this.activeSession)
      return rejected('interrupt', 'closed')
    if (!this.sdk) return { status: 'confirmed' as const, value: { effect: 'native-scope-idle' as const } }
    try {
      const receipt = await this.sdk.interrupt()
      for (const uuid of receipt?.still_queued ?? []) {
        const input = this.inputs.get(uuid)
        if (input) this.inputFacts(input, ['accepted', 'queued'])
      }
      return { status: 'confirmed' as const, value: { effect: 'requested' as const } }
    } catch (error) {
      this.report(error)
      return { status: 'unknown' as const, error: runtimeError('interrupt', 'native-error') }
    }
  }

  async stopTask(taskId: string) {
    if (this.closing || this.lost) return rejected('stopTask', 'closed')
    if (!this.tasks.has(taskId) || !this.sdk) return rejected('stopTask', 'unknown-task')
    try {
      await this.sdk.stopTask(taskId)
      return { status: 'confirmed' as const, value: { effect: 'requested' as const } }
    } catch (error) {
      this.report(error)
      return { status: 'unknown' as const, error: runtimeError('stopTask', 'native-error') }
    }
  }

  async refresh(sessionId: string): Promise<void> {
    if (this.reading) {
      await this.reading
      return this.refresh(sessionId)
    }
    this.buffered = []
    this.reading = (async () => {
      const archive = await readArchive(this.runtime.configDir, this.config.cwd, sessionId)
      if (!archive) throw new Error('native-storage-missing')
      const root = this.projection(sessionId)
      const entriesFor = (agentId?: string): SessionStoreEntry[] =>
        archive.entries
          .filter((batch) => batch.subpath === (agentId ? `subagents/agent-${agentId}` : undefined))
          .flatMap((batch) => batch.entries)
      this.archives.set(root.thread.id, root.restore(archive.messages, entriesFor()))
      for (const native of archive.children) {
        const child = this.projection(sessionId, native.agentId)
        const entries = entriesFor(native.agentId)
        this.archives.set(child.thread.id, child.restore(native.messages, entries))
        const parent = native.messages.find((message) => message.parent_agent_id)?.parent_agent_id
        const metadata = entries.find((entry) => Object.hasOwn(entry, 'parentAgentId'))
        const parentId =
          parent ??
          (metadata?.parentAgentId === null
            ? null
            : typeof metadata?.parentAgentId === 'string'
              ? metadata.parentAgentId
              : undefined)
        const task = this.tasks.get(native.agentId) ?? { sessionId, agent: true, parentId }
        this.tasks.set(native.agentId, task)
        this.relation(native.agentId, task)
      }
    })()
    try {
      await this.reading
    } finally {
      this.reading = undefined
      const buffered = this.buffered
      this.buffered = undefined
      for (const message of buffered ?? []) this.consume(message)
    }
  }

  async archive(projection: ClaudeProjection): Promise<OperationResult<ClaudeArchive>> {
    try {
      await this.refresh(projection.thread.id.split('/')[0])
      const archive = this.archives.get(projection.thread.id)
      return archive
        ? { status: 'confirmed', value: structuredClone(archive) }
        : rejected('archive', 'native-storage-missing')
    } catch (error) {
      this.report(error)
      return rejected('archive', 'native-storage-missing')
    }
  }

  async shutdown(): Promise<OperationResult<ShutdownReceipt>> {
    this.closing = true
    this.wake?.()
    this.failPending()
    this.sdk?.close()
    if (this.sdk) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        Promise.all([this.pump, this.exit]),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 5000)
        })
      ])
      clearTimeout(timeout)
      if (!this.exited) return { status: 'unknown', error: runtimeError('shutdown', 'process-exit-unconfirmed') }
      if (!this.drained) return { status: 'unknown', error: runtimeError('shutdown', 'source-drain-unconfirmed') }
      for (const sessionId of new Set([...this.projections.keys()].map((id) => id.split('/')[0]))) {
        try {
          await this.refresh(sessionId)
        } catch (error) {
          this.report(error)
        }
      }
    }
    for (const projection of this.projections.values()) projection.feed.close('shutdown')
    return { status: 'confirmed', value: { effect: 'closed' } }
  }
}
