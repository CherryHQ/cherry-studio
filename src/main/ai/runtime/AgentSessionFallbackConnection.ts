import { randomUUID } from 'node:crypto'

import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { UniqueModelId } from '@shared/data/types/model'

import { readRetryPolicy } from './aiSdk'
import { AsyncEventQueue } from './AsyncEventQueue'
import { selectFallbackModelId } from './claudeCode'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput,
  AgentSessionRuntimeDriver
} from './types'

const logger = loggerService.withContext('AgentSessionFallbackConnection')
const RETRYABLE_STATUS = /\b(429|500|502|503|529)\b/
const RETRYABLE_REASON = /rate.?limit|overload|quota|resource_exhausted/i

/** Pi and DSH surface ordinary turn errors, rather than Claude's structured result error. */
export function classifyRuntimeFallbackError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  const status = candidate.status ?? candidate.statusCode
  if (typeof status === 'number') return RETRYABLE_STATUS.test(String(status)) ? `http ${status}` : undefined
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const matched = message.match(RETRYABLE_STATUS)
  if (matched) return `http ${matched[1]}`
  return RETRYABLE_REASON.test(message) ? message.slice(0, 80) : undefined
}

/**
 * Rebuilds a Pi/DSH connection once when a provider fails before producing turn content. It owns
 * one stable event stream, so the host keeps its existing turn, persistence listener, and renderer
 * stream while the runtime's provider/model injection is rebuilt for the fallback model.
 */
export class AgentSessionFallbackConnection implements AgentRuntimeConnection {
  private readonly queue = new AsyncEventQueue<AgentRuntimeEvent>()
  readonly events = this.queue
  private current: AgentRuntimeConnection
  private currentModelId: UniqueModelId
  private lastInput?: AgentRuntimeUserInput
  private resumeToken?: string
  private hasActivity = false
  private backgroundTasksRunning = false
  private backgroundWorkActive = false
  private attempted = false
  private closed = false

  constructor(
    private readonly driver: AgentSessionRuntimeDriver,
    private readonly input: AgentRuntimeConnectInput,
    connection: AgentRuntimeConnection
  ) {
    this.current = connection
    this.currentModelId = input.modelId
    this.resumeToken = input.resumeToken
    void this.pump()
  }

  get usageCapture() {
    return this.current.usageCapture
  }

  send(input: AgentRuntimeUserInput): void | Promise<void> {
    this.lastInput = input
    this.hasActivity = false
    this.attempted = false
    return this.current.send(input)
  }

  redirect(input: AgentRuntimeUserInput): boolean {
    return this.current.redirect?.(input) ?? false
  }

  refreshTraceContext(context: Parameters<NonNullable<AgentRuntimeConnection['refreshTraceContext']>>[0]) {
    return this.current.refreshTraceContext?.(context)
  }

  reconcile(input: Parameters<AgentRuntimeConnection['reconcile']>[0]) {
    return this.current.reconcile(input)
  }

  getContextUsage() {
    return this.current.getContextUsage?.() ?? Promise.resolve(null)
  }

  getSupportedCommands() {
    return this.current.getSupportedCommands?.() ?? Promise.resolve(null)
  }

  stopTask(taskId: string) {
    return this.current.stopTask?.(taskId) ?? Promise.resolve(false)
  }

  abortTurn() {
    const current = this.current as AgentRuntimeConnection & { abortTurn?: () => Promise<boolean> }
    return current.abortTurn?.() ?? Promise.resolve(false)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.current.close()
    this.queue.close()
  }

  private async pump(): Promise<void> {
    try {
      while (!this.closed) {
        let restarted = false
        for await (const event of this.current.events) {
          if (this.closed) return
          if (event.type === 'resume-token') this.resumeToken = event.token
          // An autonomous generation can start before the host turn's terminal event.
          // Its failure does not belong to the stored send(), even if that prompt is queued.
          if (event.type === 'turn-complete' || (event.type === 'autonomous-turn-state' && event.state === 'started')) {
            this.lastInput = undefined
          }
          if (event.type === 'background-tasks') this.backgroundTasksRunning = event.tasks.length > 0
          if (event.type === 'background-work-state') this.backgroundWorkActive = event.active
          if (event.type === 'chunk') this.hasActivity = true
          if (event.type === 'error' && (await this.tryFallback(event.error))) {
            restarted = true
            break
          }
          this.queue.push(event)
        }
        if (!restarted) break
      }
    } catch (error) {
      if (!this.closed) this.queue.push({ type: 'error', error })
    } finally {
      this.queue.close()
    }
  }

  private async tryFallback(error: unknown): Promise<boolean> {
    if (
      this.closed ||
      this.attempted ||
      this.hasActivity ||
      this.backgroundTasksRunning ||
      this.backgroundWorkActive ||
      !this.lastInput
    )
      return false
    const reason = classifyRuntimeFallbackError(error)
    if (!reason) return false
    const global = readRetryPolicy()
    const configured = agentService.getAgent(this.input.agentId)?.configuration?.fallback_model_ids
    const policy = configured?.length ? { ...global, enabled: true, fallbackModelIds: configured } : global
    const fallbackModelId = selectFallbackModelId(policy, this.currentModelId)
    if (!fallbackModelId) return false
    this.attempted = true
    try {
      await this.current.close()
      if (this.closed) return false
      const connection = await this.driver.connect({
        ...this.input,
        modelId: fallbackModelId,
        resumeToken: this.resumeToken
      })
      if (this.closed) {
        await connection.close()
        return false
      }
      this.current = connection
      this.queue.push({
        type: 'chunk',
        chunk: {
          type: 'data-model-fallback',
          id: randomUUID(),
          data: { from: this.currentModelId, to: fallbackModelId, reason }
        }
      })
      this.currentModelId = fallbackModelId
      this.hasActivity = false
      await connection.send(this.lastInput)
      return true
    } catch (cause) {
      logger.warn('Pi/DSH fallback connection failed', { sessionId: this.input.sessionId, fallbackModelId, cause })
      return false
    }
  }
}
