import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import type { FinishReason, UIMessageChunk } from 'ai'

import { agentService } from '@data/services/AgentService'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import type { LocalAgentConfiguration, LocalAgentSessionInfo } from '@shared/ai/localAgent'

import { AsyncEventQueue } from '../AsyncEventQueue'
import type {
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentRuntimeReconcileResult
} from '../types'

export abstract class LocalConnection implements AgentRuntimeConnection {
  readonly events = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly localSessionInfo: LocalAgentSessionInfo = { models: [], images: false, resume: false }
  protected readonly abort = new AbortController()
  protected textId?: string
  protected active = false
  protected closed = false
  private closing?: Promise<void>
  private completeTurn?: () => void
  private turnDone: Promise<void> = Promise.resolve()
  protected readonly tools = new Set<string>()

  constructor(
    protected readonly sessionId: string,
    protected readonly agentId: string,
    protected readonly config: LocalAgentConfiguration
  ) {}

  abstract send(input: AgentRuntimeUserInput): Promise<void>
  protected abstract stop(): Promise<void>

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
    await terminateProcessTree(child, false, 'local agent')
    if (await waitForProcessExit(child, 1000)) return
    await terminateProcessTree(child, true, 'local agent')
    if (!(await waitForProcessExit(child, 1000))) throw new Error('Local agent process did not exit')
  }

  async reconcile(): Promise<AgentRuntimeReconcileResult> {
    const current = agentService.getAgent(this.agentId)?.configuration?.localRuntime
    if (!current?.enabled) return this.active ? 'rebuild' : 'invalid'
    if (this.closed) return 'rebuild'
    return JSON.stringify(current) === JSON.stringify(this.config) ? 'current' : 'rebuild'
  }

  protected chunk(chunk: UIMessageChunk) {
    this.events.push({ type: 'chunk', chunk })
  }
  protected begin() {
    if (this.closed || this.active) throw new Error('Local agent connection is unavailable')
    this.active = true
    this.turnDone = new Promise((resolve) => {
      this.completeTurn = resolve
    })
    this.tools.clear()
    this.chunk({ type: 'start' })
  }
  protected text(delta: string) {
    if (!this.active || !delta) return
    if (!this.textId) {
      this.textId = randomUUID()
      this.chunk({ type: 'text-start', id: this.textId })
    }
    this.chunk({ type: 'text-delta', id: this.textId, delta })
  }
  protected finish(error?: unknown, finishReason: FinishReason | 'cancelled' = 'stop') {
    if (!this.active) return
    this.active = false
    this.completeTurn?.()
    if (this.textId) this.chunk({ type: 'text-end', id: this.textId })
    this.textId = undefined
    if (error) this.events.push({ type: 'error', error })
    else {
      if (finishReason !== 'cancelled') this.chunk({ type: 'finish', finishReason })
      this.events.push({ type: 'turn-complete', ...(finishReason === 'cancelled' ? { cancelled: true } : {}) })
    }
  }
  protected tool(id: string, name: string, input: unknown, update = false) {
    if (this.tools.has(id) && !update) return
    this.tools.add(id)
    this.chunk({ type: 'tool-input-available', toolCallId: id, toolName: name, input, dynamic: true })
  }
  protected result(id: string, output: unknown, failed = false) {
    if (failed) {
      this.chunk({
        type: 'tool-output-error',
        toolCallId: id,
        errorText: typeof output === 'string' ? output : JSON.stringify(output),
        dynamic: true
      })
      return
    }
    this.chunk({ type: 'tool-output-available', toolCallId: id, output, dynamic: true })
  }
  protected approve(
    id: string,
    name: string,
    input: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<DispatchDecision> {
    this.tool(id, name, input, true)
    const approvalId = randomUUID()
    return new Promise((resolve) => {
      if (
        toolApprovalRegistry.register({
          approvalId,
          sessionId: this.sessionId,
          toolCallId: id,
          toolName: name,
          originalInput: input,
          signal: signal ? AbortSignal.any([this.abort.signal, signal]) : this.abort.signal,
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
