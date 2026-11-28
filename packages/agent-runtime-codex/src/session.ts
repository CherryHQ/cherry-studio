import * as z from 'zod'

import { runtimeId, type InputId, type OperationResult, type SubmitResult } from '@cherrystudio/agent-runtime'

import { codexRequestHandlers, type RequestScope, type InteractionHost } from './approvals'
import {
  CodexRequestError,
  type CodexAppServerClient,
  type CodexClientHandlers,
  type CodexIncomingRequest,
  type CodexRequestParams,
  type CodexServerCall
} from './appServerClient'
import { findCodexCommand, type CodexCommand, type CommandDefinition } from './commands'
import {
  chatArgs,
  CODEX_TURN_MODE_PARAMS,
  isMissingRollout,
  openThread,
  UNATTENDED_TURN_MODE,
  type CodexMode,
  type OpenThread,
  type SessionOptions
} from './configuration'
import { CodexControls } from './controls'
import {
  launchCodexAppServer,
  type CodexAppServerConnection,
  type CodexLaunch,
  type CodexProcessHost
} from './launcher'
import { CodexSkills } from './skills'
import { subtractTokens, tokenUsageUpdate, turnUsage, type TokenCounts } from './usage'

type ItemText = { itemId: string; phase?: string; kind: 'agentMessage' | 'plan' }
export type CodexSessionEvent =
  | { type: 'thread-changed'; threadId: string }
  | { type: 'text'; text: string }
  | (ItemText & ({ type: 'text-open' } | { type: 'text-append' | 'text-finish'; text: string }))
  | { type: 'plan'; turnId: string; steps: { step: string; status: 'pending' | 'inProgress' | 'completed' }[] }
  | { type: 'native-start'; threadId: string }
  | { type: 'native-finish' }
  | { type: 'steer-boundary'; inputIds: string[] }
  | { type: 'tool'; itemId: string; name: string; input: unknown }
  | { type: 'tool-result'; itemId: string; output: unknown; failed: boolean }
  | { type: 'finished'; error?: Error; reason: 'stop' | 'cancelled' }
  | { type: 'disconnected'; error: Error }
  | { type: 'options-changed' }
  | { type: 'session-title'; title: string }
  | { type: 'supported-commands'; commands: CodexCommand[] }
  | { type: 'compaction-start' }
  | { type: 'compaction-complete' }
  | { type: 'compaction-error'; error: string }
  | {
      type: 'usage'
      threadId: string
      model?: string
      usage: ReturnType<typeof turnUsage>
      lastRequest: { turnId: string; inputTokens: number; modelContextWindow?: number }
    }

interface SessionHost extends InteractionHost {
  connect(args: string[], handlers: CodexClientHandlers): CodexAppServerConnection
  emit(event: CodexSessionEvent): void
}
type Content = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string }
type ActiveTurn = {
  id?: string
  controller: AbortController
  nativeStarted?: boolean
  expectsStart?: boolean
  interruptRequested?: boolean
  steers?: Map<InputId, { dispatched: boolean; settle(result: SubmitResult): void }>
  manualCompaction?: {
    settle(result: OperationResult<void>): void
    itemId?: string
    completed?: true
  }
  compacting: boolean
  unattendedDenial?: Error
  usageBaseline?: TokenCounts
  approvalItems: Map<string, Record<string, unknown>>
}

const nativeItem = z.looseObject({ id: z.string(), type: z.string() })
const completedTurn = z.object({
  id: z.string().optional(),
  status: z.string(),
  error: z.object({ message: z.string() }).nullish()
})

export class CodexSession {
  private readonly requests = new Map<string | number, AbortController>()
  private turn?: ActiveTurn
  private lastUsage?: TokenCounts
  private modeOverride?: CodexMode
  private effortOverride?: string
  private controls = new CodexControls()
  private controlDiscovery?: Promise<void>
  private commandsObserved = false
  private readonly skills: CodexSkills
  private constructor(
    private readonly client: CodexAppServerClient,
    private readonly options: SessionOptions,
    private readonly thread: OpenThread,
    private readonly host: Omit<SessionHost, 'connect'>,
    private readonly closeTransport: CodexAppServerConnection['close']
  ) {
    this.skills = new CodexSkills(client, options.cwd)
  }

  static launch(
    launch: CodexLaunch,
    options: Omit<SessionOptions, 'cwd'>,
    host: Omit<SessionHost, 'connect'> & CodexProcessHost
  ) {
    return CodexSession.open(
      { ...options, cwd: launch.cwd },
      { ...host, connect: (args, handlers) => launchCodexAppServer(launch, host, handlers, args) }
    )
  }

  static async open(options: SessionOptions, host: SessionHost) {
    let session: CodexSession | undefined
    const transport = new AbortController()
    const signal = AbortSignal.any([options.signal, transport.signal])
    signal.throwIfAborted()
    const server = host.connect(chatArgs(options), {
      requests: codexRequestHandlers(async (call, apply) => {
        if (!session) throw new CodexRequestError('Thread is not bound', -32602)
        return session.handleRequest(call, apply)
      }),
      onNotification: (call) => session?.notify(call),
      onDisconnect: (error) => {
        transport.abort(error)
        session?.finish(error)
        host.emit({ type: 'disconnected', error })
      }
    })
    const close = () => {
      transport.abort()
      return server.close()
    }
    const cancel = () => void close().catch(() => {})
    options.signal.addEventListener('abort', cancel, { once: true })
    if (options.signal.aborted) cancel()
    try {
      const client = await server.ready
      signal.throwIfAborted()
      const scope = { ...options, signal }
      await openThread(client, scope, (thread) => {
        if (session && session.id === thread.id) Object.assign(session.thread, thread)
        else session = new CodexSession(client, scope, thread, host, close)
      })
      signal.throwIfAborted()
      if (!session) throw new Error('Codex did not bind a thread')
      void session.loadControls()
      return session
    } catch (error) {
      await server.close().catch(() => {})
      throw error
    } finally {
      options.signal.removeEventListener('abort', cancel)
    }
  }

  get id() {
    return this.thread.id
  }
  get info() {
    const info = this.thread.info
    return {
      ...info,
      mode: this.controls.collaboration === 'plan' ? { ...info.mode, currentValue: 'readOnly' as const } : info.mode
    }
  }

  close() {
    this.finish(undefined, 'stop', false)
    return this.closeTransport()
  }

  private loadControls() {
    return (this.controlDiscovery ??= this.discoverControls())
  }
  private async discoverControls() {
    const controls = this.controls
    controls.collaboration ??=
      this.thread.collaboration ?? (this.thread.info.mode.currentValue === 'readOnly' ? 'plan' : undefined)
    if (this.options.headless || !this.client.atLeast(172)) return
    const threadId = this.id
    await controls.discover(this.client, threadId, this.thread.info.activeModel?.id)
    if (controls === this.controls && controls.goals && !this.options.signal.aborted)
      await controls.goalCommand(this.client, threadId, '').catch(() => {
        controls.goals = false
      })
    if (controls !== this.controls || this.options.signal.aborted) return
    this.host.emit({ type: 'options-changed' })
  }

  async listCommands(): Promise<CodexCommand[]> {
    if (this.options.headless) return []
    this.commandsObserved = true
    await this.loadControls()
    return [...CodexSession.listBuiltinCommands(this), ...(await this.listSkillCommands())]
  }

  private async listSkillCommands(): Promise<CodexCommand[]> {
    const skills = await this.skills.list()
    const commands: CodexCommand[] = []
    for (const { name, description } of skills.values()) {
      if (!this.command(name)) commands.push({ name, description, argumentHint: '', builtin: false })
    }
    return commands
  }

  setMode(id: string, value: string) {
    this.requireIdle()
    const { mode } = this.thread.info
    const option = mode.options.find((o) => o.value === value)
    if (id !== mode.id || !option) throw new Error('This session option is no longer available')
    this.selectMode(option.value)
    return this.info
  }

  private selectMode(value: CodexMode) {
    this.controls.collaboration = value === 'readOnly' ? 'plan' : 'default'
    if (value === 'readOnly') return
    this.modeOverride = value
    this.thread.info = { ...this.thread.info, mode: { ...this.thread.info.mode, currentValue: value } }
  }

  setThoughtLevel(id: string, value: string) {
    this.requireIdle()
    const { thoughtLevel } = this.thread.info
    if (!thoughtLevel || id !== thoughtLevel.id || !thoughtLevel.options.some((o) => o.value === value))
      throw new Error('This session option is no longer available')
    this.effortOverride = value === 'default' ? undefined : value
    this.thread.info = { ...this.thread.info, thoughtLevel: { ...thoughtLevel, currentValue: value } }
    return this.info
  }
  private requireIdle() {
    if (this.options.signal.aborted || this.turn) throw new Error('Codex session is unavailable or busy')
  }

  private async handleRequest<T>(call: CodexIncomingRequest, apply: (scope: RequestScope) => Promise<T>) {
    const { threadId, turnId } = call.params
    const turn = this.turn
    if (
      threadId !== this.id ||
      !turn ||
      (turnId == null ? call.method !== 'mcpServer/elicitation/request' : turnId !== turn.id)
    )
      throw new CodexRequestError('Unknown thread or turn', -32602)
    if (this.options.headless) {
      turn.unattendedDenial ??= new Error('The local agent requested approval or user input during a scheduled task')
    }
    if (this.requests.has(call.id)) throw new CodexRequestError('Duplicate server request ID', -32600)
    const controller = new AbortController()
    this.requests.set(call.id, controller)
    try {
      return await apply({
        headless: this.options.headless,
        fullAccess: this.controls.collaboration !== 'plan' && this.thread.info.mode.currentValue === 'fullAccess',
        knownItems: turn.approvalItems,
        signal: AbortSignal.any([this.options.signal, turn.controller.signal, controller.signal]),
        host: this.host
      })
    } finally {
      this.requests.delete(call.id)
    }
  }

  private notify({ method, params }: CodexServerCall) {
    if (method === 'skills/changed') {
      this.skills.invalidate()
      if (this.commandsObserved)
        void this.listCommands().then((commands) => {
          if (!this.options.signal.aborted) this.host.emit({ type: 'supported-commands', commands })
        })
      return
    }
    if (params.threadId !== undefined && params.threadId !== this.id) return
    if (method === 'serverRequest/resolved') {
      if (params.threadId === this.id && (typeof params.requestId === 'string' || typeof params.requestId === 'number'))
        this.requests.get(params.requestId)?.abort()
      return
    }
    if (method === 'turn/started' && params.threadId === this.id) {
      const { id } = z.object({ id: z.string() }).parse(params.turn)
      if (!this.turn?.expectsStart && !this.turn?.id) {
        if (this.options.headless || this.options.signal.aborted) return
        if (this.turn) this.finish()
        this.turn = {
          id,
          nativeStarted: true,
          controller: new AbortController(),
          compacting: false,
          approvalItems: new Map()
        }
        this.host.emit({ type: 'native-start', threadId: this.id })
      } else if (this.turn && !this.turn.id) this.bindTurn(this.turn, id)
      return
    }
    const turn = this.turn
    if (!turn || (params.turnId !== undefined && params.turnId !== turn.id)) return
    if (turn.manualCompaction) {
      this.observeManualCompaction(turn, method, params)
      return
    }
    switch (method) {
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
        if (typeof params.itemId === 'string' && typeof params.delta === 'string' && params.delta)
          this.host.emit({
            type: 'text-append',
            itemId: params.itemId,
            kind: method === 'item/plan/delta' ? 'plan' : 'agentMessage',
            text: params.delta
          })
        break
      case 'turn/plan/updated': {
        const plan = z
          .array(z.object({ step: z.string(), status: z.enum(['pending', 'inProgress', 'completed']) }))
          .safeParse(params.plan)
        if (turn.id && plan.success) this.host.emit({ type: 'plan', turnId: turn.id, steps: plan.data })
        break
      }
      case 'thread/tokenUsage/updated': {
        if (!turn.id || params.turnId !== turn.id) return
        const parsed = tokenUsageUpdate.safeParse(params.tokenUsage)
        if (!parsed.success) return
        const { total, last, modelContextWindow } = parsed.data
        this.lastUsage = total
        turn.usageBaseline ??= subtractTokens(total, last)
        this.host.emit({
          type: 'usage',
          threadId: this.id,
          model: this.thread.info.activeModel?.id,
          usage: turnUsage(total, turn.usageBaseline),
          lastRequest: {
            turnId: turn.id,
            inputTokens: last.inputTokens,
            modelContextWindow:
              modelContextWindow && modelContextWindow > 0 ? modelContextWindow : this.thread.modelContextWindow
          }
        })
        break
      }
      case 'item/started':
      case 'item/completed': {
        const item = nativeItem.parse(params.item)
        const complete = method === 'item/completed'
        if (
          item.type === 'userMessage' &&
          !complete &&
          params.turnId === turn.id &&
          typeof item.clientId === 'string'
        ) {
          const inputId = runtimeId<'input'>(item.clientId)
          const receipt = turn.steers?.get(inputId)
          if (receipt?.dispatched) {
            turn.steers?.delete(inputId)
            this.host.emit({ type: 'steer-boundary', inputIds: [inputId] })
            receipt.settle({ status: 'acknowledged', inputId, facts: ['accepted', 'placed'] })
            return
          }
        }
        if (item.type === 'agentMessage' || item.type === 'plan') {
          const identity = {
            itemId: item.id,
            kind: item.type,
            phase: typeof item.phase === 'string' ? item.phase : undefined
          } as const
          this.host.emit(
            complete
              ? { type: 'text-finish', ...identity, text: typeof item.text === 'string' ? item.text : '' }
              : { type: 'text-open', ...identity }
          )
          return
        }
        if (item.type === 'contextCompaction') {
          this.compaction(turn, !complete)
          if (complete) this.host.emit({ type: 'text', text: 'Conversation context compacted.' })
          return
        }
        if (complete) turn.approvalItems.delete(item.id)
        else if (item.type === 'commandExecution' || item.type === 'fileChange') turn.approvalItems.set(item.id, item)
        if (!['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(item.type)) return
        const failed = item.status === 'failed' || item.status === 'declined'
        const mcp = this.options.mcp
        if (
          mcp &&
          item.type === 'mcpToolCall' &&
          item.server === mcp.name &&
          typeof item.tool === 'string' &&
          mcp.approvedTools.includes(item.tool)
        ) {
          const input =
            item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments) ? item.arguments : {}
          this.host.emit({ type: 'tool', itemId: item.id, name: `mcp__${mcp.name}__${item.tool}`, input })
          if (complete)
            this.host.emit({
              type: 'tool-result',
              itemId: item.id,
              output: (failed ? (item.error ?? item.result) : item.result) ?? item,
              failed
            })
        } else {
          this.host.emit({ type: 'tool', itemId: item.id, name: item.type, input: item })
          if (complete) this.host.emit({ type: 'tool-result', itemId: item.id, output: item, failed })
        }
        break
      }
      case 'thread/compacted':
        this.compaction(turn, false)
        break
      case 'turn/completed': {
        const event = completedTurn.parse(params.turn)
        if (event.id && event.id !== turn.id) return
        if (turn.compacting && event.status === 'failed')
          this.host.emit({ type: 'compaction-error', error: event.error?.message ?? 'Codex compaction failed' })
        else this.compaction(turn, false)
        this.finish(
          event.status === 'failed' ? new Error(event.error?.message ?? 'Codex turn failed') : undefined,
          event.status === 'interrupted' ? 'cancelled' : 'stop'
        )
        break
      }
      case 'error':
        if (params.willRetry !== true)
          this.finish(new Error(z.object({ message: z.string() }).parse(params.error).message))
    }
  }

  private compaction(turn: ActiveTurn, active: boolean) {
    if (turn.compacting === active) return
    turn.compacting = active
    this.host.emit({ type: active ? 'compaction-start' : 'compaction-complete' })
  }

  private finish(error?: Error, reason: 'stop' | 'cancelled' = 'stop', publish = true) {
    const turn = this.turn
    if (!turn) return
    this.turn = undefined
    if (reason === 'cancelled') turn.interruptRequested = true
    for (const [inputId, steer] of turn.steers ?? [])
      steer.settle(
        steer.dispatched
          ? {
              status: 'unknown',
              inputId,
              error: { operation: 'steer', code: 'missing-echo', message: 'Codex did not confirm input delivery' }
            }
          : endedSteer(turn, inputId)
      )
    turn.steers?.clear()
    turn.controller.abort()
    if (turn.manualCompaction) {
      turn.manualCompaction.settle({
        status: 'unknown',
        error: {
          operation: 'compact',
          code: 'missing-receipt',
          message: error?.message ?? 'Codex compaction ended without confirmation'
        }
      })
      return
    }
    if (!publish) return
    this.host.emit({
      type: 'finished',
      error: error ?? (reason === 'stop' ? turn.unattendedDenial : undefined),
      reason
    })
    if (turn.nativeStarted) this.host.emit({ type: 'native-finish' })
  }

  private switchThread(turn: ActiveTurn, threadId: string, text: string) {
    turn.controller.signal.throwIfAborted()
    this.thread.id = threadId
    this.thread.collaboration = undefined
    const collaboration = this.controls.collaboration
    this.controls = new CodexControls()
    this.controls.collaboration = collaboration
    this.controlDiscovery = undefined
    this.lastUsage = undefined
    this.host.emit({ type: 'thread-changed', threadId })
    this.host.emit({ type: 'text', text })
    this.finish()
  }

  private async refreshControlsAfterSwitch() {
    const threadId = this.id
    await this.loadControls()
    if (this.commandsObserved && threadId === this.id && !this.options.signal.aborted) {
      const commands = await this.listCommands()
      if (threadId === this.id && !this.options.signal.aborted) this.host.emit({ type: 'supported-commands', commands })
    }
  }

  private bindTurn(turn: ActiveTurn, id: string) {
    if (this.turn !== turn || turn.id) return
    turn.id = id
    if (turn.interruptRequested) void this.interrupt().catch(() => {})
  }

  async steer(inputId: InputId, read: () => Promise<readonly Content[]>): Promise<SubmitResult> {
    const turn = this.turn
    if (
      !turn?.id ||
      this.options.signal.aborted ||
      this.options.headless ||
      turn.compacting ||
      turn.manualCompaction ||
      !this.client.atLeast(172)
    )
      return rejectedSteer(inputId, 'unavailable', 'Codex has no steerable turn')
    if (turn.interruptRequested) return endedSteer(turn, inputId)

    const steers = (turn.steers ??= new Map())
    if (steers.has(inputId))
      return {
        status: 'unknown',
        inputId,
        error: { operation: 'steer', code: 'duplicate-input', message: 'Codex already has this input' }
      }
    const receipt = Promise.withResolvers<SubmitResult>()
    const steer = { dispatched: false, settle: receipt.resolve }
    const expectedTurnId = turn.id
    steers.set(inputId, steer)
    const dispatch = async () => {
      try {
        const input = (await read()).map(toNativeInput)
        if (steers.get(inputId) !== steer) return
        if (this.turn !== turn || turn.interruptRequested || this.options.signal.aborted) {
          steers.delete(inputId)
          receipt.resolve(endedSteer(turn, inputId))
          return
        }
        steer.dispatched = true
        await this.client.request('turn/steer', {
          threadId: this.id,
          expectedTurnId,
          clientUserMessageId: inputId,
          input
        })
      } catch (error) {
        if (steers.get(inputId) !== steer) return
        if (!steer.dispatched) {
          steers.delete(inputId)
          receipt.resolve(
            rejectedSteer(inputId, 'not-dispatched', error instanceof Error ? error.message : String(error))
          )
          return
        }
        if (error instanceof CodexRequestError && (error.code === -32601 || error.code === -32602)) {
          steers.delete(inputId)
          receipt.resolve(rejectedSteer(inputId, 'refused', error.message))
        }
      }
    }
    void dispatch()
    return receipt.promise
  }

  async compact(): Promise<OperationResult<void>> {
    if (this.turn || this.options.signal.aborted || this.options.headless)
      return {
        status: 'rejected',
        error: { operation: 'compact', code: 'unavailable', message: 'Codex is unavailable or busy' }
      }
    const turn: ActiveTurn = { controller: new AbortController(), compacting: false, approvalItems: new Map() }
    this.turn = turn
    try {
      return await this.runManualCompaction(turn)
    } finally {
      if (this.turn === turn) {
        this.turn = undefined
        turn.controller.abort()
      }
    }
  }

  private async runManualCompaction(turn: ActiveTurn): Promise<OperationResult<void>> {
    const terminal = Promise.withResolvers<OperationResult<void>>()
    turn.expectsStart = true
    turn.manualCompaction = { settle: terminal.resolve }
    void this.client.request('thread/compact/start', { threadId: this.id }).catch((error: unknown) => {
      const missing = isMissingRollout(error)
      const refused = error instanceof CodexRequestError && (error.code === -32601 || error.code === -32602)
      terminal.resolve({
        status: missing || refused ? 'rejected' : 'unknown',
        error: {
          operation: 'compact',
          code: missing ? 'empty-history' : refused ? 'refused' : 'missing-receipt',
          message: error instanceof Error ? error.message : String(error)
        }
      })
    })
    try {
      return await terminal.promise
    } finally {
      turn.manualCompaction = undefined
      turn.expectsStart = false
    }
  }

  private observeManualCompaction(turn: ActiveTurn, method: string, params: Record<string, unknown>): void {
    const operation = turn.manualCompaction
    if (!operation || params.threadId !== this.id) return
    if (method === 'error' && params.willRetry !== true) {
      const error = z.object({ message: z.string() }).parse(params.error)
      operation.settle({
        status: 'unknown',
        error: { operation: 'compact', code: 'native-error', message: error.message }
      })
      return
    }
    if (turn.id && params.turnId === turn.id && (method === 'item/started' || method === 'item/completed')) {
      const item = nativeItem.parse(params.item)
      if (item.type !== 'contextCompaction') return
      if (method === 'item/started') operation.itemId ??= item.id
      else if (operation.itemId === item.id) operation.completed = true
      return
    }
    if (method !== 'turn/completed') return
    const event = completedTurn.parse(params.turn)
    if (!turn.id || event.id !== turn.id) return
    if (event.status === 'completed' && operation.completed) {
      operation.settle({ status: 'confirmed', value: undefined })
    } else {
      const code =
        event.status === 'interrupted' ? 'cancelled' : event.status === 'failed' ? 'failed' : 'missing-receipt'
      operation.settle({
        status: code === 'missing-receipt' ? 'unknown' : 'rejected',
        error: { operation: 'compact', code, message: event.error?.message ?? 'Codex did not complete compaction' }
      })
    }
  }

  async send(content: readonly Content[], inputId?: string) {
    this.requireIdle()
    const turn: ActiveTurn = { controller: new AbortController(), compacting: false, approvalItems: new Map() }
    this.turn = turn
    const text =
      !this.options.headless && content.length === 1 && content[0]?.type === 'text' ? content[0].text.trim() : undefined
    try {
      let promptText: string | undefined
      let skillInput: Extract<CodexRequestParams['turn/start']['input'][number], { type: 'skill' }> | undefined
      const match = text?.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
      if (match) {
        const [, name, args = ''] = match
        const definition = findCodexCommand(CodexSession.registry, name)
        if (definition?.available) {
          await this.loadControls()
          if (this.turn !== turn) return
        }
        const command = definition?.available && !definition.available(this) ? undefined : definition
        if (command && (!args || command.argumentHint !== undefined)) {
          const result = await command.run(this, turn, args)
          if (this.turn !== turn) return
          if (typeof result === 'string') {
            this.host.emit({ type: 'text', text: result })
            this.finish()
            return
          }
          if ('running' in result) return
          promptText = result.prompt
        } else if (!command) {
          const skill = (await this.skills.list()).get(name)
          if (this.turn !== turn) return
          if (skill) {
            skillInput = { type: 'skill', name: skill.name, path: skill.path }
            promptText = args || `Use the ${skill.name} skill.`
          } else if (definition?.available) {
            this.host.emit({ type: 'text', text: `/${name} is unavailable in this Codex session.` })
            this.finish()
            return
          }
        }
      }
      const input =
        promptText === undefined ? content.map(toNativeInput) : [toNativeInput({ type: 'text', text: promptText })]
      if (skillInput) input.unshift(skillInput)
      if (this.controls.collaboration) {
        await this.loadControls()
        if (this.turn !== turn) return
      }
      turn.expectsStart = true
      const effort = this.thread.info.thoughtLevel?.currentValue
      const mode = this.controls.collaboration === 'plan' ? 'readOnly' : this.modeOverride
      await this.client.request(
        'turn/start',
        {
          clientUserMessageId: inputId,
          ...this.controls.turnSettings(
            this.thread.info.activeModel?.id,
            this.effortOverride ?? (effort === 'default' ? undefined : effort)
          ),
          threadId: this.id,
          input,
          ...(this.options.headless ? UNATTENDED_TURN_MODE : mode ? CODEX_TURN_MODE_PARAMS[mode] : {}),
          ...(this.effortOverride && { effort: this.effortOverride })
        },
        ({ turn: native }) => this.bindTurn(turn, native.id)
      )
    } catch (error) {
      if (this.turn === turn) this.finish(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private static readonly registry: readonly CommandDefinition<CodexSession, ActiveTurn>[] = [
    {
      name: 'clear',
      aliases: ['new'],
      description: 'Start a new conversation with empty context',
      async run(session, turn) {
        await session.client.request('thread/start', session.thread.params, ({ thread }) =>
          session.switchThread(turn, thread.id, 'Started a new conversation with empty context.')
        )
        void session.refreshControlsAfterSwitch()
        return { running: true }
      }
    },
    {
      name: 'compact',
      description: 'Free up context by summarizing the conversation so far',
      argumentHint: '',
      async run(session, turn) {
        session.compaction(turn, true)
        const result = await session.runManualCompaction(turn)
        if (result.status === 'confirmed' || result.error.code === 'empty-history') {
          session.compaction(turn, false)
          return result.status === 'confirmed'
            ? 'Conversation context compacted.'
            : 'Nothing to compact yet — send a message first.'
        }
        turn.compacting = false
        session.host.emit({ type: 'compaction-error', error: result.error.message })
        throw new Error(result.error.message)
      }
    },
    {
      name: 'usage',
      description: 'Show session token usage',
      run: (session) => session.describeUsage(false)
    },
    {
      name: 'status',
      description: 'Show current session configuration and token usage',
      run: (session) => session.describeUsage(true)
    },
    {
      name: 'review',
      description: 'Review current changes and find issues',
      argumentHint: '[instructions]',
      async run(session, turn, instructions) {
        turn.expectsStart = true
        await session.client.request(
          'review/start',
          {
            threadId: session.id,
            target: instructions ? { type: 'custom', instructions } : { type: 'uncommittedChanges' }
          },
          ({ turn: native }) => session.bindTurn(turn, native.id)
        )
        return { running: true }
      }
    },
    {
      name: 'diff',
      description: 'Show git diff or working tree status',
      async run(session) {
        const cwd = session.options.cwd
        const diff =
          (await session.client.request('gitDiffToRemote', { cwd }).catch(() => null))?.diff.trim() ||
          (
            await session.client
              .request('command/exec', { command: ['git', 'status', '--short'], cwd })
              .catch(() => null)
          )?.stdout.trim()
        return diff ? '```diff\n' + diff + '\n```' : 'No git diff reported.'
      }
    },
    {
      name: 'init',
      description: 'Create an AGENTS.md file with instructions for Codex',
      argumentHint: '[instructions]',
      run: (_session, _turn, args) => ({
        prompt:
          `Create or update an AGENTS.md file with project architecture, build/test commands, and conventions. ${args}`.trim()
      })
    },
    {
      name: 'mcp',
      description: 'List MCP tools and server status',
      async run(session) {
        const catalog = await session.client.request('mcpServerStatus/list', {}).catch(() => null)
        return (
          catalog?.data
            .map((s) => `- **${s.name}**: ${Object.keys(s.tools ?? {}).length} tools (${s.authStatus ?? 'ready'})`)
            .join('\n') || 'No MCP servers configured in Codex.'
        )
      }
    },
    {
      name: 'skills',
      description: 'List skills available to Codex in this workspace',
      async run(session) {
        const skills = await session.listSkillCommands()
        return (
          skills.map((s) => `- **/${s.name}**${s.description ? `: ${s.description}` : ''}`).join('\n') ||
          'No Codex skills discovered in this workspace.'
        )
      }
    },
    {
      name: 'plan',
      description: 'Enter Plan mode, or leave it with /plan off',
      argumentHint: '[task | off]',
      available: (session) => session.controls.plan,
      run(session, _turn, task) {
        const mode = session.thread.info.mode.currentValue
        session.selectMode(task === 'off' ? (mode === 'readOnly' ? 'workspace' : mode) : 'readOnly')
        session.host.emit({ type: 'options-changed' })
        return task === 'off' ? 'Left Plan mode.' : task ? { prompt: task } : 'Entered Plan mode.'
      }
    },
    {
      name: 'goal',
      description: 'Read, set, pause, resume or clear the thread goal',
      argumentHint: '[objective | pause | resume | clear]',
      available: (session) => session.controls.goals,
      run(session, _turn, args) {
        return session.controls.goalCommand(session.client, session.id, args)
      }
    },
    {
      name: 'fork',
      description: 'Fork the current chat into a new thread',
      async run(session, turn) {
        try {
          await session.client.request(
            'thread/fork',
            { threadId: session.id, ...(session.client.atLeast(145) && { excludeTurns: true }) },
            ({ thread }) => session.switchThread(turn, thread.id, `Forked into thread ${thread.id}.`)
          )
          void session.refreshControlsAfterSwitch()
          return { running: true }
        } catch (error) {
          if (!isMissingRollout(error)) throw error
          return 'Send at least one message before forking this conversation.'
        }
      }
    },
    {
      name: 'undo',
      description: 'Undo the last turn in the current thread',
      async run(session, turn) {
        const threadId = session.id
        const {
          data: [last]
        } = await session.client.request('thread/turns/list', {
          threadId,
          limit: 1,
          sortDirection: 'desc',
          itemsView: 'summary'
        })
        turn.controller.signal.throwIfAborted()
        if (!last) return 'No previous turn to undo in this session.'
        session.options.signal.throwIfAborted()
        if (session.id !== threadId || last.status === 'inProgress')
          throw new Error('Cannot undo an active or changed thread')
        await session.client.request('thread/revert', { threadId, beforeTurnId: last.id })
        turn.controller.signal.throwIfAborted()
        return 'Reverted the last turn.'
      }
    },
    {
      name: 'rename',
      description: 'Rename the current thread',
      argumentHint: '<name>',
      async run(session, turn, name) {
        if (!name) return 'Usage: /rename <name>'
        await session.client.request('thread/name/set', { threadId: session.id, name }).catch((error) => {
          if (!isMissingRollout(error)) throw error
        })
        turn.controller.signal.throwIfAborted()
        session.host.emit({ type: 'session-title', title: name })
        return `Renamed thread to "${name}".`
      }
    }
  ]

  private command(name: string) {
    const command = findCodexCommand(CodexSession.registry, name)
    return command?.available && !command.available(this) ? undefined : command
  }

  static listBuiltinCommands(session?: CodexSession): CodexCommand[] {
    return CodexSession.registry
      .filter((cmd) => !cmd.available || (session && cmd.available(session)))
      .map(({ name, aliases, description, argumentHint }) => ({
        name,
        description,
        argumentHint: argumentHint ?? '',
        ...(aliases && { aliases: [...aliases] }),
        builtin: true
      }))
  }

  private async describeUsage(includeStatus: boolean) {
    const usage = await this.client.request('account/usage/read', { threadId: this.id }).catch(() => null)
    const total = this.lastUsage
    const lines = includeStatus ? [`Thread ID: ${this.id}`, `Working directory: ${this.options.cwd}`] : []
    if (this.thread.info.activeModel) lines.push('Model: ' + this.thread.info.activeModel.id)
    lines.push(
      total
        ? `Thread tokens: ${total.totalTokens} total (${total.inputTokens} input, ${total.outputTokens} output, ${total.cachedInputTokens} cached)`
        : usage
          ? `Usage: ${JSON.stringify(usage)}`
          : 'No token usage recorded for this session yet.'
    )
    return lines.join('\n')
  }

  async interrupt() {
    const turn = this.turn
    if (!turn) return
    if (!turn.id && !turn.expectsStart) {
      this.finish(undefined, 'cancelled')
      return
    }
    if (turn.interruptRequested && !turn.id) return
    turn.interruptRequested = true
    for (const [inputId, steer] of turn.steers ?? []) {
      if (steer.dispatched) continue
      turn.steers?.delete(inputId)
      steer.settle(endedSteer(turn, inputId))
    }
    if (turn.id) await this.client.request('turn/interrupt', { threadId: this.id, turnId: turn.id })
  }
}

function rejectedSteer(inputId: InputId, code: string, message: string): SubmitResult {
  return { status: 'rejected', inputId, error: { operation: 'steer', code, message } }
}

function endedSteer(turn: ActiveTurn, inputId: InputId): SubmitResult {
  return turn.interruptRequested
    ? rejectedSteer(inputId, 'cancelled-before-dispatch', 'Codex stopped before dispatching the input')
    : rejectedSteer(inputId, 'turn-ended', 'The original Codex turn ended')
}

export const listCodexBuiltinCommands = CodexSession.listBuiltinCommands
export type { CodexCommand } from './commands'

export { CodexRestoreError, describeCodexModel, type CodexThreadRestore } from './configuration'

function toNativeInput(part: Content): CodexRequestParams['turn/start']['input'][number] {
  return part.type === 'image'
    ? { type: 'image', url: `data:${part.mimeType};base64,${part.data}` }
    : { type: 'text', text: part.text, text_elements: [] }
}
