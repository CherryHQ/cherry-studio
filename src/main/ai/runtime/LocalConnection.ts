import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { DynamicToolUIPart, FinishReason } from 'ai'

import { runtimeId, type ItemRef, type RuntimePartEdit } from '@cherrystudio/agent-runtime'
import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentProviderService } from '@data/services/AgentProviderService'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import {
  ElicitationFormSchema,
  elicitationChoices,
  elicitationValidator,
  type ElicitationContent
} from '@shared/ai/elicitation'
import type { LocalAgentRuntime, LocalAgentSessionInfo } from '@shared/ai/localAgent'
import { AsyncEventQueue } from '@shared/utils/async'

import {
  bindLocalContext,
  localBindingMatches,
  localContext,
  type LocalLaunchTarget
} from '../agentSession/localContext'
import { bindNativeInput } from '../agentSession/nativeSubmission'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentRuntimeReconcileResult
} from './types'

export type LocalSource = { ref: ItemRef; contextId: string; nextPart: number }

export abstract class LocalConnection implements AgentRuntimeConnection {
  readonly sessionCostScope = 'native-session' as const
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  private info?: LocalAgentSessionInfo
  get localRuntime(): LocalAgentRuntime {
    return this.config
  }
  get localSessionInfo(): LocalAgentSessionInfo {
    return (this.info ??= { models: [], images: false, resume: false })
  }
  protected supportedCommands: AgentSessionSlashCommand[] | null = null
  protected readonly abort = new AbortController()
  protected turnAbort = new AbortController()
  private unattendedDenial?: string
  private context?: AgentSessionContextRow
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
  protected readonly tools = new Map<string, { part: number; source: LocalSource; name: string; input?: unknown }>()

  constructor(
    protected readonly sessionId: string,
    protected readonly agentId: string,
    protected readonly config: LocalAgentRuntime,
    private target: LocalLaunchTarget,
    protected readonly headless = false
  ) {
    if (target.kind === 'resume') this.context = target.context
  }

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

  async reconcile({ headless = false }: { headless?: boolean } = {}): Promise<AgentRuntimeReconcileResult> {
    if (headless !== this.headless) return 'rebuild'
    const current = agentProviderService.getBinding(this.agentId)
    if (!current?.enabled) return this.active ? 'rebuild' : 'invalid'
    if (this.closed) return 'rebuild'
    return localBindingMatches(this.target, current, this.config.browserControl) ? 'current' : 'rebuild'
  }

  protected publishResumeToken(token: string) {
    this.nativeThreadId = token
    if (this.context && !this.context.nativeThreadId) this.context = bindLocalContext(this.context.id, token)
    this.events.push({ type: 'resume-token', token })
  }
  protected attachLocalContext(nativeId: string): boolean {
    if (this.context?.nativeThreadId === nativeId) return true
    const context = agentSessionContextService.localRootForThread(this.sessionId, this.config.providerId, nativeId)
    if (!context) return false
    this.context = context
    this.nativeThreadId = nativeId
    this.target = { ...this.target, kind: 'resume', context }
    return true
  }

  claimLocalContext(inputId: string, resume = this.nativeThreadId): boolean {
    if (
      this.context &&
      (!resume || this.context.nativeThreadId === resume) &&
      isDeepStrictEqual(this.context.localModel, this.target.model)
    ) {
      return localBindingMatches(this.target, agentProviderService.getBinding(this.agentId), this.config.browserControl)
    }
    const context = localContext(this.sessionId, this.agentId, inputId, this.target, this.config.browserControl, resume)
    if (!context) return false
    this.context = resume && !context.nativeThreadId ? bindLocalContext(context.id, resume) : context
    this.target = { ...this.target, kind: 'resume', context: this.context }
    return true
  }

  protected begin(input: string | AgentRuntimeUserInput, resume = this.nativeThreadId) {
    const inputId = typeof input === 'string' ? input : input.message.id
    if (this.closed || this.active) throw new Error('Local agent connection is unavailable')
    if (
      (!this.context || (resume && this.context.nativeThreadId !== resume)) &&
      !this.claimLocalContext(inputId, resume)
    )
      throw new Error('Local agent binding changed before input was admitted')
    if (typeof input !== 'string' && input.context?.length && this.context)
      bindNativeInput(this.sessionId, this.context.id, input.message)
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
  protected continueSource() {
    this.endContent()
    this.activeSource = this.openSource()
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
  protected get source(): LocalSource {
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
    this.publishToolPart(
      { type: 'dynamic-tool', toolCallId: id, toolName: name, state: 'input-available', input },
      input
    )
  }
  protected publishToolPart(value: DynamicToolUIPart, pendingInput?: unknown) {
    const previous = this.tools.get(value.toolCallId)
    const source = previous?.source ?? this.source
    const part = previous?.part ?? source.nextPart++
    this.tools.set(value.toolCallId, { part, source, name: value.toolName, input: pendingInput })
    this.editPart({ type: 'put', part, value }, source)
  }
  protected result(id: string, output: unknown, failed = false, resultProviderMetadata?: SharedV3ProviderMetadata) {
    const slot = this.tools.get(id)
    if (!slot) return
    const identity = {
      type: 'dynamic-tool' as const,
      toolName: slot.name,
      toolCallId: id,
      input: slot.input,
      resultProviderMetadata
    }
    this.publishToolPart(
      failed
        ? {
            ...identity,
            state: 'output-error',
            errorText: typeof output === 'string' ? output : JSON.stringify(output)
          }
        : { ...identity, state: 'output-available', output },
      slot.input
    )
  }
  protected denyUnattendedRequest(): { approved: false; reason: string } {
    const reason = 'The local agent requested approval or user input during a scheduled task'
    if (this.active) this.unattendedDenial = reason
    return { approved: false, reason }
  }

  protected async elicit(message: string, schema: unknown, agentName: string, requestSignal: AbortSignal) {
    const parsed = ElicitationFormSchema.safeParse(schema)
    if (!parsed.success) throw new RangeError('Unsupported elicitation schema')
    let validator: ReturnType<typeof elicitationValidator>
    try {
      validator = elicitationValidator(parsed.data)
    } catch {
      throw new RangeError('Invalid elicitation schema')
    }
    const questions = Object.entries(parsed.data.properties).map(([id, field]) => ({
      id,
      question: field.title ?? id,
      header: field.title ?? id,
      options: elicitationChoices(field),
      multiSelect: field.type === 'array'
    }))
    const id = randomUUID()
    const input = {
      questions: questions.length
        ? questions
        : [{ question: message, header: message, options: [], multiSelect: false }],
      elicitation: {
        schema: parsed.data,
        message: message,
        agentName: agentName
      }
    }
    const turn = this.turnAbort.signal
    const signal = AbortSignal.any([turn, requestSignal])
    const answer = await this.approve(id, 'AskUserQuestion', input, signal)
    const validated = validator.safeParse(answer.updatedInput?.elicitationContent)
    const action =
      signal.aborted || this.abort.signal.aborted || answer.updatedInput?.elicitationAction === 'cancel'
        ? 'cancel'
        : !answer.approved
          ? 'decline'
          : validated.success
            ? 'accept'
            : 'cancel'
    const outcome =
      action === 'accept' ? ({ action, content: validated.data as ElicitationContent } as const) : ({ action } as const)
    if (this.active && !turn.aborted)
      this.result(id, {
        ...input,
        answers: action === 'accept' ? answer.updatedInput?.answers : {},
        elicitationOutcome: outcome
      })
    return outcome
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
    const turn = this.turnAbort.signal
    const contextId = this.source.contextId
    return new Promise((resolve) => {
      if (
        toolApprovalRegistry.register({
          approvalId,
          sessionId: this.sessionId,
          toolCallId: id,
          toolName: name,
          originalInput: input,
          contextId,
          signal: AbortSignal.any([this.abort.signal, turn, ...(signal ? [signal] : [])]),
          resolve: (decision) => {
            if (signal?.aborted && !turn.aborted && !this.abort.signal.aborted)
              this.events.push({ type: 'tool-approval-withdrawn', contextId, toolCallId: id, approvalId })
            resolve(decision)
          }
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
    this.events.close()
  }
}
