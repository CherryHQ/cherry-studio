import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { DynamicToolUIPart, FinishReason } from 'ai'

import { runtimeId, type ItemRef, type RuntimePartEdit } from '@cherrystudio/agent-runtime'
import { agentService } from '@data/services/AgentService'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import type { LocalAgentConfiguration, LocalAgentSessionInfo } from '@shared/ai/localAgent'
import { AsyncEventQueue } from '@shared/utils/async'

import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentRuntimeReconcileResult
} from '../types'
import { bindLocalContext, localContext } from './localContext'

type LocalSource = { ref: ItemRef; contextId: string; nextPart: number }

export abstract class LocalConnection implements AgentRuntimeConnection {
  readonly sessionCostScope = 'native-session' as const
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly localSessionInfo: LocalAgentSessionInfo = { models: [], images: false, resume: false }
  protected supportedCommands: AgentSessionSlashCommand[] | null = null
  protected readonly abort = new AbortController()
  protected turnAbort = new AbortController()
  private unattendedDenial?: string
  private context?: ReturnType<typeof localContext>
  private nativeThreadId?: string
  private activeSource?: LocalSource
  private contentPart?: { type: 'text' | 'reasoning'; part: number }
  get contextId() {
    return this.context?.id
  }
  protected active = false
  protected closed = false
  private closing?: Promise<void>
  private completeTurn?: () => void
  private turnDone: Promise<void> = Promise.resolve()
  protected readonly tools = new Map<string, { part: number; source: LocalSource; value: DynamicToolUIPart }>()

  constructor(
    protected readonly sessionId: string,
    protected readonly agentId: string,
    protected readonly config: LocalAgentConfiguration,
    protected readonly headless = false
  ) {}

  abstract send(input: AgentRuntimeUserInput): Promise<void>
  protected abstract stop(): Promise<void>

  async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    return this.supportedCommands
  }

  protected publishCommands(commands: AgentSessionSlashCommand[]) {
    this.supportedCommands = commands
    this.events.push({ type: 'supported-commands', commands })
  }

  close(): Promise<void> {
    this.closed = true
    this.abort.abort()
    return (this.closing ??= this.stop().finally(() => this.dispose()))
  }
  closeForEdit(): Promise<void> {
    return this.close()
  }
  protected async waitForTurn() {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.turnDone,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  protected async stopProcess(child?: ChildProcess) {
    if (!child?.pid) return
    if (process.platform === 'win32') {
      // Headless console processes ignore non-forced taskkill; signal EOF briefly then force-reap the tree.
      try {
        child.stdin?.end()
      } catch {
        /* ignore closed stdio */
      }
      if (await waitForProcessExit(child, 150)) return
      await terminateProcessTree(child, true, 'local agent')
      if (!(await waitForProcessExit(child, 1000))) throw new Error('Local agent process did not exit')
      return
    }
    await terminateProcessTree(child, false, 'local agent')
    if (await waitForProcessExit(child, 1000)) return
    await terminateProcessTree(child, true, 'local agent')
    if (!(await waitForProcessExit(child, 1000))) throw new Error('Local agent process did not exit')
  }

  async reconcile({ headless = false }: { headless?: boolean } = {}): Promise<AgentRuntimeReconcileResult> {
    if (headless !== this.headless) return 'rebuild'
    const current = agentService.getAgent(this.agentId)?.configuration?.localRuntime
    if (!current?.enabled) return this.active ? 'rebuild' : 'invalid'
    if (this.closed) return 'rebuild'
    return JSON.stringify(current) === JSON.stringify(this.config) ? 'current' : 'rebuild'
  }

  protected publishResumeToken(token: string) {
    this.nativeThreadId = token
    if (this.context && !this.context.nativeThreadId) this.context = bindLocalContext(this.context.id, token)
    this.events.push({ type: 'resume-token', token })
  }
  protected begin(inputId: string, resume = this.nativeThreadId) {
    if (this.closed || this.active) throw new Error('Local agent connection is unavailable')
    if (!this.context || (resume && this.context.nativeThreadId !== resume)) {
      this.context = localContext(this.sessionId, this.agentId, inputId, resume)
      if (resume && !this.context.nativeThreadId) this.context = bindLocalContext(this.context.id, resume)
    }
    this.activeSource = this.openSource()
    this.active = true
    this.unattendedDenial = undefined
    this.turnAbort = new AbortController()
    this.turnDone = new Promise((resolve) => {
      this.completeTurn = resolve
    })
    this.tools.clear()
    return this.activeSource
  }
  protected openSource(
    toolOwner?: Extract<AgentRuntimeEvent, { type: 'message-projection' }>['toolOwner']
  ): LocalSource {
    const context = this.context
    if (!context) throw new Error('Local turn has no execution context')
    const id = runtimeId<'item'>(randomUUID())
    const ref: ItemRef = { id, session: { id: runtimeId(context.id), backendId: runtimeId(context.backendId) } }
    this.events.push({
      type: 'message-projection',
      projection: {
        contextId: context.id,
        messages: [{ id, role: 'assistant', parts: [] }],
        live: [id],
        removed: [],
        replaces: {}
      },
      toolOwner
    })
    return { ref, contextId: context.id, nextPart: 0 }
  }
  private get source(): LocalSource {
    if (!this.activeSource) throw new Error('Content outside a local turn')
    return this.activeSource
  }
  protected editPart(edit: RuntimePartEdit, source = this.source) {
    this.events.push({ type: 'message.parts', ref: source.ref, contextId: source.contextId, changes: [edit] })
  }
  protected putData(
    value: Extract<RuntimePartEdit, { type: 'put' }>['value'],
    part = this.source.nextPart++,
    source = this.source
  ) {
    this.editPart({ type: 'put', part, value }, source)
    return part
  }
  protected endContent() {
    if (this.contentPart) this.editPart({ type: 'finish', part: this.contentPart.part })
    this.contentPart = undefined
  }
  protected content(delta: string, type: 'text' | 'reasoning' = 'text', providerMetadata?: SharedV3ProviderMetadata) {
    if (!this.active || !delta) return
    if (this.contentPart?.type !== type) {
      this.endContent()
      this.contentPart = { type, part: this.source.nextPart++ }
      this.editPart({ type: 'open', kind: type, part: this.contentPart.part, providerMetadata })
    }
    this.editPart({ type: 'append', part: this.contentPart.part, text: delta })
  }
  protected finish(error?: unknown, finishReason: FinishReason | 'cancelled' = 'stop') {
    if (!this.active) return
    this.active = false
    this.turnAbort.abort()
    this.completeTurn?.()
    this.endContent()
    this.tools.clear()
    this.activeSource = undefined
    if (!error && finishReason !== 'cancelled' && this.unattendedDenial) error = new Error(this.unattendedDenial)
    if (error) this.events.push({ type: 'error', error })
    else {
      this.events.push({
        type: 'turn-complete',
        ...(finishReason === 'cancelled' ? { status: 'paused' } : { finishReason })
      })
    }
  }
  protected tool(id: string, name: string, input: unknown, update = false) {
    if (this.tools.has(id) && !update) return
    this.putTool({ type: 'dynamic-tool', toolCallId: id, toolName: name, state: 'input-available', input })
  }
  protected putTool(value: DynamicToolUIPart, source = this.source) {
    const existing = this.tools.get(value.toolCallId)
    source = existing?.source ?? source
    const part = existing?.part ?? source.nextPart++
    this.tools.set(value.toolCallId, { part, value, source })
    this.editPart({ type: 'put', part, value }, source)
  }
  protected result(id: string, output: unknown, failed = false, resultProviderMetadata?: SharedV3ProviderMetadata) {
    const slot = this.tools.get(id)
    if (!slot) return
    const { toolName, input, title, providerExecuted, callProviderMetadata } = slot.value
    const identity = {
      type: 'dynamic-tool' as const,
      toolName,
      toolCallId: id,
      input,
      title,
      providerExecuted,
      callProviderMetadata,
      resultProviderMetadata
    }
    const tool: DynamicToolUIPart = failed
      ? { ...identity, state: 'output-error', errorText: typeof output === 'string' ? output : JSON.stringify(output) }
      : { ...identity, state: 'output-available', output }
    this.events.push({
      type: 'message.tool-output',
      ref: slot.source.ref,
      contextId: slot.source.contextId,
      part: slot.part,
      tool
    })
  }
  protected denyUnattendedRequest(): { approved: false; reason: string } {
    const reason = 'The local agent requested approval or user input during a scheduled task'
    if (this.active) this.unattendedDenial = reason
    return { approved: false, reason }
  }

  protected approve(
    id: string,
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<DispatchDecision> {
    this.tool(id, name, input, true)
    if (this.headless) {
      const denial = this.denyUnattendedRequest()
      this.result(id, denial.reason, true)
      return Promise.resolve(denial)
    }
    const approvalId = randomUUID()
    return new Promise((resolve) => {
      if (
        toolApprovalRegistry.register({
          approvalId,
          sessionId: this.sessionId,
          toolCallId: id,
          toolName: name,
          originalInput: input,
          signal: AbortSignal.any([this.abort.signal, this.turnAbort.signal, ...(signal ? [signal] : [])]),
          resolve
        })
      ) {
        this.events.push({
          type: 'tool-approval-request',
          request: { approvalId, toolCallId: id, toolName: name, input, presentation: 'stream' }
        })
      }
    })
  }
  protected dispose() {
    this.closed = true
    this.abort.abort()
    toolApprovalRegistry.abort(this.sessionId)
    this.events.close()
  }
}
