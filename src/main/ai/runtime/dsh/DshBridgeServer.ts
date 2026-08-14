/**
 * Per-connection control-plane host for the dsh bridge plugin: a `net.Server`
 * on a short-lived local socket speaking the `@cherrystudio/dsh-bridge`
 * newline-JSON protocol. Owns request/result correlation (open / prompt /
 * cancel / policyUpdate), the `ready` handshake, and the interactive
 * approval round-trip (`approvalAsk` → tool-approval registry → answer).
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {
  type BridgeContextUsage,
  type BridgeToolCallResult,
  createBridgeFrameDecoder,
  encodeBridgeMessage,
  type HostToBridgeMessage
} from '@cherrystudio/dsh-bridge'
import { loggerService } from '@logger'
import type { CherryToolMeta } from '@shared/data/types/uiParts'

import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type { AgentRuntimeEvent } from '../types'
import { DSH_TRANSPORT } from './dshStreamAdapter'

const logger = loggerService.withContext('DshBridgeServer')

const READY_TIMEOUT_MS = 15_000

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** Correlated control messages — `approvalAnswer` is answer-only and never yields a `result`;
 *  `contextUsage`/`command` have typed result frames behind their own wrappers. */
export type DshBridgeRequest = DistributiveOmit<
  Exclude<HostToBridgeMessage, { type: 'approvalAnswer' | 'contextUsage' | 'command' }>,
  'id'
>

/** Outcome of one dispatched slash command; `handled: false` = not a registered command. */
export interface DshBridgeCommandOutcome {
  handled: boolean
  kind?: 'success' | 'error'
  text?: string
}

export interface DshBridgeServerOptions {
  /** Agent-session id — keys the neutral approval registry so close()/abort target the right approvals. */
  sessionId: string
  /** Push a runtime-neutral event into the connection queue; the host owns presentation. */
  emit: (event: AgentRuntimeEvent) => void
  /** Resolve responder availability at ask-time so warm connections follow the current turn. */
  getInteractionState: () => { userResponse: 'stream' | 'message' | 'unavailable' }
  /** Dispatch one registered dsh native tool into Cherry's in-process MCP bridge. */
  onToolCall: (name: string, args: unknown, signal: AbortSignal) => Promise<BridgeToolCallResult>
}

interface PendingResult {
  resolve: (value?: unknown) => void
  reject: (error: Error) => void
  timer?: NodeJS.Timeout
}

/** macOS `sun_path` caps at ~104 chars, so the socket lives in tmpdir — NEVER under userData. */
function createBridgeSocketPath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\cherry-dsh-${randomUUID()}`
  return path.join(os.tmpdir(), `cherry-dsh-${randomUUID().slice(0, 8)}.sock`)
}

export class DshBridgeServer {
  readonly socketPath = createBridgeSocketPath()
  readonly authenticationToken = randomBytes(32).toString('base64url')

  private server?: net.Server
  private connection?: net.Socket
  private readonly unauthenticatedSockets = new Set<net.Socket>()
  private requestSeq = 0
  private readonly pendingResults = new Map<string, PendingResult>()
  private readonly activeToolCalls = new Map<string, AbortController>()
  private ready = false
  private readonly readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private closed = false

  constructor(private readonly options: DshBridgeServerOptions) {}

  async listen(): Promise<void> {
    const server = net.createServer((socket) => this.handleConnection(socket))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    if (process.platform !== 'win32') {
      await chmod(this.socketPath, 0o600).catch((error) => {
        logger.warn('failed to chmod dsh bridge socket', { error })
      })
    }
  }

  /** Resolves when the plugin's `ready` frame arrives (it connects as the composition boots). */
  whenReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.closed) return Promise.reject(new Error('dsh bridge server is closed'))
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.readyWaiters.indexOf(waiter)
        if (index !== -1) this.readyWaiters.splice(index, 1)
        reject(new Error(`dsh bridge plugin did not report ready within ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      const waiter = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (error: Error) => {
          clearTimeout(timer)
          reject(error)
        }
      }
      this.readyWaiters.push(waiter)
    })
  }

  /** Send one correlated control message and await its `result`; rejects on `ok: false`. */
  request(message: DshBridgeRequest, options?: { timeoutMs?: number }): Promise<void> {
    return this.sendCorrelated(message, options).then(() => undefined)
  }

  /** Query the plugin's `ctx.tokenMeter` measurement for this connection's session. */
  requestContextUsage(sessionId: string, options?: { timeoutMs?: number }): Promise<BridgeContextUsage> {
    return this.sendCorrelated({ type: 'contextUsage', sessionId }, options).then((value) => {
      const usage = value as BridgeContextUsage | undefined
      if (!usage || typeof usage.totalTokens !== 'number') {
        throw new Error('dsh bridge returned no context usage payload')
      }
      return usage
    })
  }

  /** Dispatch one slash-command line through the plugin's `ctx.commands` registry. No timeout —
   *  a command can wrap an LLM round-trip (compaction); a dead plugin rejects via socket close. */
  requestCommand(sessionId: string, line: string): Promise<DshBridgeCommandOutcome> {
    return this.sendCorrelated({ type: 'command', sessionId, line }).then((value) => value as DshBridgeCommandOutcome)
  }

  private sendCorrelated(
    message:
      | DshBridgeRequest
      | { type: 'contextUsage'; sessionId: string }
      | { type: 'command'; sessionId: string; line: string },
    options?: { timeoutMs?: number }
  ): Promise<unknown> {
    const connection = this.connection
    if (!connection || connection.destroyed) {
      return Promise.reject(new Error('dsh bridge plugin is not connected'))
    }
    const id = String(++this.requestSeq)
    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingResult = { resolve, reject }
      if (options?.timeoutMs) {
        pending.timer = setTimeout(() => {
          this.pendingResults.delete(id)
          reject(new Error(`dsh bridge ${message.type} timed out after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
        pending.timer.unref?.()
      }
      this.pendingResults.set(id, pending)
      connection.write(encodeBridgeMessage({ ...message, id }))
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.failPending(new Error('dsh bridge server closed'))
    this.abortToolCalls()
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(new Error('dsh bridge server closed'))
    for (const socket of this.unauthenticatedSockets) socket.destroy()
    this.unauthenticatedSockets.clear()
    this.connection?.destroy()
    this.connection = undefined
    const server = this.server
    this.server = undefined
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    if (process.platform !== 'win32') {
      await rm(this.socketPath, { force: true }).catch(() => undefined)
    }
  }

  private handleConnection(socket: net.Socket): void {
    if (this.closed || this.connection) {
      socket.destroy()
      return
    }
    this.unauthenticatedSockets.add(socket)
    let authenticated = false
    socket.setTimeout(READY_TIMEOUT_MS, () => socket.destroy())
    socket.on('error', (error) => logger.warn('dsh bridge socket error', { error }))
    socket.on('close', () => {
      this.unauthenticatedSockets.delete(socket)
      if (this.connection === socket) this.connection = undefined
      if (authenticated) {
        this.failPending(new Error('dsh bridge plugin disconnected'))
        this.abortToolCalls()
      }
    })
    socket.on(
      'data',
      createBridgeFrameDecoder((message) => {
        if (!authenticated) {
          if (!this.authenticate(socket, message)) socket.destroy()
          else authenticated = true
          return
        }
        this.handleMessage(message)
      })
    )
  }

  private authenticate(socket: net.Socket, message: unknown): boolean {
    if (this.closed || this.connection || !isRecord(message)) return false
    if (message.type !== 'ready' || !Number.isSafeInteger(message.pid) || typeof message.token !== 'string')
      return false
    const expected = Buffer.from(this.authenticationToken)
    const received = Buffer.from(message.token)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false

    this.unauthenticatedSockets.delete(socket)
    socket.setTimeout(0)
    this.connection = socket
    this.ready = true
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve()
    return true
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const frame = message as Record<string, unknown>
    switch (frame.type) {
      case 'result': {
        const pending = this.takePending(frame.id)
        if (!pending) return
        if (frame.ok) pending.resolve()
        else pending.reject(new Error(String(frame.error ?? 'dsh bridge request failed')))
        return
      }
      case 'contextUsageResult': {
        const pending = this.takePending(frame.id)
        if (!pending) return
        if (frame.ok) pending.resolve(frame.usage)
        else pending.reject(new Error(String(frame.error ?? 'dsh bridge context usage failed')))
        return
      }
      case 'commandResult': {
        const pending = this.takePending(frame.id)
        if (!pending) return
        if (frame.ok) {
          pending.resolve({
            handled: frame.handled === true,
            ...(frame.kind === 'success' || frame.kind === 'error' ? { kind: frame.kind } : {}),
            ...(typeof frame.text === 'string' ? { text: frame.text } : {})
          })
        } else {
          pending.reject(new Error(String(frame.error ?? 'dsh bridge command failed')))
        }
        return
      }
      case 'toolCall':
        void this.handleToolCall(frame)
        return
      case 'toolCallCancel':
        if (frame.sessionId === this.options.sessionId) this.activeToolCalls.get(String(frame.id ?? ''))?.abort()
        return
      case 'approvalAsk':
        this.handleApprovalAsk(frame)
        return
      default:
        return
    }
  }

  private async handleToolCall(call: Record<string, unknown>): Promise<void> {
    const id = String(call.id ?? '')
    if (call.sessionId !== this.options.sessionId) {
      this.answerToolCall(id, { ok: false, error: 'dsh bridge tool call used the wrong session' })
      return
    }
    if (!id || this.activeToolCalls.has(id)) {
      this.answerToolCall(id, { ok: false, error: 'dsh bridge tool call id is missing or already active' })
      return
    }
    const controller = new AbortController()
    this.activeToolCalls.set(id, controller)
    try {
      const result = await this.options.onToolCall(String(call.name ?? ''), call.args, controller.signal)
      if (controller.signal.aborted) return
      this.answerToolCall(id, { ok: true, ...result })
    } catch (error) {
      if (controller.signal.aborted) return
      this.answerToolCall(id, { ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.activeToolCalls.get(id) === controller) this.activeToolCalls.delete(id)
    }
  }

  private handleApprovalAsk(ask: Record<string, unknown>): void {
    const askId = String(ask.id ?? '')
    const toolName = String(ask.toolName ?? '')
    const interactionState = this.options.getInteractionState()
    if (interactionState.userResponse === 'unavailable') {
      // Unattended turn — fail closed immediately (the wire carries no reason channel).
      this.answerApproval(askId, 'rejected')
      return
    }

    const approvalId = randomUUID()
    const toolCallId = typeof ask.callId === 'string' && ask.callId ? ask.callId : approvalId
    const input =
      typeof ask.args === 'object' && ask.args !== null && !Array.isArray(ask.args)
        ? (ask.args as Record<string, unknown>)
        : {}
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    const pending = toolApprovalRegistry.register({
      approvalId,
      sessionId: this.options.sessionId,
      toolCallId,
      toolName,
      originalInput: { ...input },
      presentation,
      resolve: (decision) => {
        // dsh forbids rewriting tool input, so an edited-input approval degrades to a rejection.
        if (decision.approved && decision.updatedInput) {
          logger.warn('editing tool input is not supported by the dsh runtime; rejecting', { toolName })
        }
        this.answerApproval(askId, decision.approved && !decision.updatedInput ? 'allowed-once' : 'rejected')
      }
    })
    // Only surface the approval card when the request is actually pending; a synchronous
    // resolve already settled the promise, and emitting would leave an unanswerable card.
    if (!pending) return
    this.options.emit({
      type: 'tool-approval-request',
      request: {
        approvalId,
        toolCallId,
        toolName,
        input: { ...input },
        presentation,
        providerMetadata: { cherry: { transport: DSH_TRANSPORT, toolName } satisfies CherryToolMeta }
      }
    })
  }

  private takePending(id: unknown): PendingResult | undefined {
    const pending = this.pendingResults.get(String(id))
    if (!pending) return undefined
    this.pendingResults.delete(String(id))
    if (pending.timer) clearTimeout(pending.timer)
    return pending
  }

  private answerApproval(askId: string, outcome: 'allowed-once' | 'rejected'): void {
    const connection = this.connection
    if (!connection || connection.destroyed) return
    connection.write(encodeBridgeMessage({ type: 'approvalAnswer', id: askId, outcome }))
  }

  private answerToolCall(
    id: string,
    result: ({ ok: true } & BridgeToolCallResult) | { ok: false; error: string }
  ): void {
    const connection = this.connection
    if (!connection || connection.destroyed) return
    connection.write(encodeBridgeMessage({ type: 'toolCallResult', id, ...result }))
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pendingResults) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingResults.clear()
  }

  private abortToolCalls(): void {
    for (const controller of this.activeToolCalls.values()) controller.abort()
    this.activeToolCalls.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
