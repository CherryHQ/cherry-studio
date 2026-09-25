import { loggerService } from '@logger'

import type { AgentRuntimeEvent } from '../types'
import type { UarHostMcpBridge } from './UarHostMcpBridge'
import { UarToolApprovalController } from './UarToolApprovalController'

const logger = loggerService.withContext('UarAguiAdapter')

type AguiEvent = {
  type?: unknown
  profile?: unknown
  eventId?: unknown
  sequence?: unknown
  messageId?: unknown
  delta?: unknown
  code?: unknown
  message?: unknown
  name?: unknown
  runId?: unknown
  toolCallId?: unknown
  toolCallName?: unknown
  arguments?: unknown
  content?: unknown
  isError?: unknown
  stepId?: unknown
  stepName?: unknown
  messages?: unknown
  result?: unknown
  value?: unknown
}

interface UarAguiAdapterOptions {
  sessionId: string
  agentId: string
  runId: string
  generation: number
  principal: string
  signal: AbortSignal
  bridge: UarHostMcpBridge
  emit(event: AgentRuntimeEvent): void
  isClosed(): boolean
}

export class UarAguiAdapter {
  private readonly approvals: UarToolApprovalController
  private readonly startedTools = new Set<string>()
  private readonly completedInputs = new Set<string>()
  private readonly completedTools = new Set<string>()
  private readonly seenEventIds = new Set<string>()
  private readonly toolNames = new Map<string, string>()
  private activeStepId?: string
  private currentSourceEventId?: string
  private lastCompletedSourceEventId?: string
  private lastSequence = -1
  private textOpen = false
  private textId = ''
  private reasoningOpen = false
  private reasoningId = ''
  private hasText = false
  private terminal = false

  constructor(private readonly options: UarAguiAdapterOptions) {
    this.approvals = new UarToolApprovalController(options)
  }

  isTerminal(): boolean {
    return this.terminal
  }

  replayCursor(): string {
    return this.lastCompletedSourceEventId ?? '0'
  }

  prepareReconnect(): void {
    this.currentSourceEventId = undefined
  }

  async consume(response: Response): Promise<void> {
    if (!response.body) throw new Error('UAR stream returned no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        this.handleFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
      if (done) break
    }
    if (buffer.trim()) this.handleFrame(buffer)
  }

  private handleFrame(frame: string): void {
    const lines = frame.split('\n')
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const sourceEventId = lines
      .find((line) => line.startsWith('id:'))
      ?.slice(3)
      .trim()
    if (!sourceEventId) throw new Error('UAR emitted an AG-UI event without an SSE event ID')
    this.noteSourceEvent(sourceEventId)
    const event = JSON.parse(data) as AguiEvent
    if (typeof event.runId === 'string' && event.runId !== this.options.runId) {
      throw new Error(`UAR emitted an event for the wrong run: ${event.runId}`)
    }
    if (!this.acceptEvent(event)) return
    switch (event.type) {
      case 'STEP_STARTED':
        this.handleStepStarted(event)
        break
      case 'STEP_FINISHED':
        this.handleStepFinished(event)
        break
      case 'TEXT_MESSAGE_CONTENT':
        this.handleText(event)
        break
      case 'REASONING_MESSAGE_CONTENT':
        this.handleReasoning(event)
        break
      case 'MESSAGES_SNAPSHOT':
        this.handleMessagesSnapshot(event)
        break
      case 'TOOL_CALL_START':
        if (typeof event.toolCallId === 'string' && typeof event.toolCallName === 'string') {
          this.ensureToolInput(event.toolCallId, event.toolCallName)
        }
        break
      case 'TOOL_CALL_END':
        if (typeof event.toolCallId === 'string' && typeof event.toolCallName === 'string') {
          this.ensureToolInput(event.toolCallId, event.toolCallName)
        }
        break
      case 'TOOL_CALL_RESULT':
        this.handleToolResult(event)
        break
      case 'CUSTOM':
        this.handleCustom(event)
        break
      case 'RUN_FINISHED':
        this.handleUsage(event)
        this.finish()
        break
      case 'RUN_ERROR':
        this.fail(event)
        break
    }
  }

  private handleText(event: AguiEvent): void {
    if (typeof event.delta !== 'string' || !event.delta) return
    const base = typeof event.messageId === 'string' ? event.messageId : `${this.options.runId}:assistant`
    const id = `${base}:${this.activeStepId ?? 'run'}`
    if (this.textOpen && this.textId !== id) this.closeText()
    if (!this.textOpen) {
      this.textOpen = true
      this.textId = id
      this.options.emit({ type: 'chunk', chunk: { type: 'text-start', id } })
    }
    this.hasText = true
    this.options.emit({ type: 'chunk', chunk: { type: 'text-delta', id, delta: event.delta } })
  }

  private handleReasoning(event: AguiEvent): void {
    if (typeof event.delta !== 'string' || !event.delta) return
    const base = typeof event.messageId === 'string' ? event.messageId : `${this.options.runId}:reasoning`
    const id = `${base}:${this.activeStepId ?? 'run'}`
    if (this.reasoningOpen && this.reasoningId !== id) this.closeReasoning()
    if (!this.reasoningOpen) {
      this.reasoningOpen = true
      this.reasoningId = id
      this.options.emit({ type: 'chunk', chunk: { type: 'reasoning-start', id } })
    }
    this.options.emit({ type: 'chunk', chunk: { type: 'reasoning-delta', id, delta: event.delta } })
  }

  private handleMessagesSnapshot(event: AguiEvent): void {
    if (this.hasText || !Array.isArray(event.messages)) return
    const assistant = event.messages.find(
      (message): message is Record<string, unknown> => isRecord(message) && message.role === 'assistant'
    )
    if (!assistant || typeof assistant.content !== 'string' || !assistant.content) return
    this.handleText({ messageId: assistant.id, delta: assistant.content })
  }

  private handleStepStarted(event: AguiEvent): void {
    const stepId = stepIdentity(event)
    if (!stepId) throw new Error('UAR emitted a step without a stable identifier')
    if (this.activeStepId) throw new Error(`UAR started ${stepId} before ${this.activeStepId} finished`)
    this.closeBlocks()
    this.activeStepId = stepId
    this.options.emit({ type: 'chunk', chunk: { type: 'start-step' } })
  }

  private handleStepFinished(event: AguiEvent): void {
    const stepId = stepIdentity(event)
    if (!stepId || stepId !== this.activeStepId) {
      throw new Error(`UAR finished an unexpected step: ${String(stepId)}`)
    }
    this.closeBlocks()
    this.options.emit({ type: 'chunk', chunk: { type: 'finish-step' } })
    this.activeStepId = undefined
  }

  private handleToolResult(event: AguiEvent): void {
    if (typeof event.toolCallId !== 'string') throw new Error('UAR emitted a tool result without a tool call ID')
    const toolName = this.toolNames.get(event.toolCallId) ?? 'unknown'
    const toolCallId = this.ensureToolInput(event.toolCallId, toolName, {})
    if (this.completedTools.has(toolCallId)) return
    this.completedTools.add(toolCallId)
    const output = parseToolOutput(event.content)
    this.options.emit({
      type: 'chunk',
      chunk:
        event.isError === true
          ? {
              type: 'tool-output-error',
              toolCallId,
              errorText: stringifyToolOutput(output),
              dynamic: true,
              providerExecuted: true
            }
          : { type: 'tool-output-available', toolCallId, output, dynamic: true, providerExecuted: true }
    })
  }

  private handleCustom(event: AguiEvent): void {
    if (!isRecord(event.value)) return
    if (event.name === 'uar.tool.denied') {
      const value = event.value
      if (typeof value.toolCallId !== 'string') return
      const toolName = typeof value.name === 'string' ? value.name : (this.toolNames.get(value.toolCallId) ?? 'unknown')
      const toolCallId = this.ensureToolInput(value.toolCallId, toolName, {})
      if (!this.completedTools.has(toolCallId)) {
        this.completedTools.add(toolCallId)
        this.options.emit({ type: 'chunk', chunk: { type: 'tool-output-denied', toolCallId } })
      }
      return
    }
    if (event.name !== 'uar.tool.approval_required') return
    void this.approvals
      .handle(event.value, (rawToolCallId, toolName, input) => this.ensureToolInput(rawToolCallId, toolName, input))
      .catch((error) => {
        if (!this.options.signal.aborted && !this.options.isClosed()) this.options.emit({ type: 'error', error })
      })
  }

  private finish(): void {
    this.terminal = true
    this.completeSourceEvent()
    this.approvals.abort('UAR turn finished')
    this.closeInterruptedTools('Tool result indeterminate because the UAR run finished without a terminal tool result')
    this.closeBlocks()
    this.closeStep()
    this.options.emit({ type: 'turn-complete' })
  }

  private fail(event: AguiEvent): void {
    this.terminal = true
    this.completeSourceEvent()
    this.approvals.abort('UAR turn failed')
    this.closeInterruptedTools('Tool result indeterminate because the UAR run ended before completion')
    this.closeBlocks()
    this.closeStep()
    this.options.emit({
      type: 'error',
      error: new Error(typeof event.message === 'string' ? event.message : `UAR run failed (${String(event.code)})`)
    })
  }

  private ensureToolInput(rawToolCallId: string, toolName: string, input?: Record<string, unknown>): string {
    const toolCallId = `uar:${this.options.runId}:${rawToolCallId}`
    this.toolNames.set(rawToolCallId, toolName)
    this.toolNames.set(toolCallId, toolName)
    if (!this.startedTools.has(toolCallId)) {
      this.startedTools.add(toolCallId)
      this.options.emit({
        type: 'chunk',
        chunk: { type: 'tool-input-start', toolCallId, toolName, dynamic: true, providerExecuted: true }
      })
    }
    if (input && !this.completedInputs.has(toolCallId)) {
      this.completedInputs.add(toolCallId)
      this.options.emit({
        type: 'chunk',
        chunk: { type: 'tool-input-available', toolCallId, toolName, input, dynamic: true, providerExecuted: true }
      })
    }
    return toolCallId
  }

  interrupt(error: unknown): void {
    if (this.terminal) return
    this.terminal = true
    this.approvals.abort('UAR turn interrupted')
    this.closeInterruptedTools('Tool result indeterminate because the UAR stream was interrupted')
    this.closeBlocks()
    this.closeStep()
    logger.warn('UAR stream interrupted', { runId: this.options.runId, error })
  }

  private closeInterruptedTools(reason: string): void {
    for (const toolCallId of this.startedTools) {
      if (this.completedTools.has(toolCallId)) continue
      if (!this.completedInputs.has(toolCallId)) {
        this.completedInputs.add(toolCallId)
        this.options.emit({
          type: 'chunk',
          chunk: {
            type: 'tool-input-available',
            toolCallId,
            toolName: this.toolNames.get(toolCallId) ?? 'unknown',
            input: {},
            dynamic: true,
            providerExecuted: true
          }
        })
      }
      this.completedTools.add(toolCallId)
      this.options.emit({
        type: 'chunk',
        chunk: { type: 'tool-output-error', toolCallId, errorText: reason, dynamic: true, providerExecuted: true }
      })
    }
  }

  private closeBlocks(): void {
    this.closeText()
    this.closeReasoning()
  }

  private closeStep(): void {
    if (!this.activeStepId) return
    this.options.emit({ type: 'chunk', chunk: { type: 'finish-step' } })
    this.activeStepId = undefined
  }

  private closeText(): void {
    if (!this.textOpen) return
    this.options.emit({ type: 'chunk', chunk: { type: 'text-end', id: this.textId } })
    this.textOpen = false
  }

  private closeReasoning(): void {
    if (!this.reasoningOpen) return
    this.options.emit({ type: 'chunk', chunk: { type: 'reasoning-end', id: this.reasoningId } })
    this.reasoningOpen = false
  }

  private handleUsage(event: AguiEvent): void {
    if (!isRecord(event.result) || !isRecord(event.result.usage)) return
    const usage = event.result.usage
    const inputTokens = tokenCount(usage.inputTokens)
    const outputTokens = tokenCount(usage.outputTokens)
    const totalTokens = tokenCount(usage.totalTokens)
    if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return
    this.options.emit({
      type: 'chunk',
      chunk: {
        type: 'message-metadata',
        messageMetadata: { totalTokens, stats: { inputTokens, outputTokens, totalTokens } }
      }
    })
    if (typeof usage.model === 'string' && usage.model) {
      this.options.emit({
        type: 'usage',
        invocation: {
          requestId: `uar:${this.options.runId}`,
          model: usage.model,
          messageAssociation: 'current-turn',
          usage: {
            inputTokens,
            outputTokens,
            totalTokens,
            noCacheTokens: inputTokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          }
        }
      })
    }
  }

  private acceptEvent(event: AguiEvent): boolean {
    if (event.profile !== 'uar.agui/1')
      throw new Error(`UAR emitted an unsupported AG-UI profile: ${String(event.profile)}`)
    if (
      typeof event.eventId !== 'string' ||
      typeof event.sequence !== 'number' ||
      !Number.isSafeInteger(event.sequence)
    ) {
      throw new Error('UAR emitted an AG-UI event without stable ordering metadata')
    }
    if (this.seenEventIds.has(event.eventId)) return false
    this.seenEventIds.add(event.eventId)
    if (event.sequence < this.lastSequence) return false
    this.lastSequence = event.sequence
    return true
  }

  private noteSourceEvent(sourceEventId: string): void {
    if (this.currentSourceEventId && sourceEventId !== this.currentSourceEventId) {
      this.lastCompletedSourceEventId = this.currentSourceEventId
    }
    this.currentSourceEventId = sourceEventId
  }

  private completeSourceEvent(): void {
    if (this.currentSourceEventId) this.lastCompletedSourceEventId = this.currentSourceEventId
  }
}

function parseToolOutput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stepIdentity(event: AguiEvent): string | undefined {
  if (typeof event.stepId === 'string' && event.stepId) return event.stepId
  return typeof event.stepName === 'string' && event.stepName ? event.stepName : undefined
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
