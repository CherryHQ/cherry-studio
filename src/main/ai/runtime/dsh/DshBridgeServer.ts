/**
 * Per-connection control-plane host for the dsh bridge plugin: a `net.Server`
 * on a short-lived local socket speaking the `@cherrystudio/dsh-bridge` method
 * vocabulary over dsh's own `JsonRpcLineTransport`. Owns the `ready` handshake
 * (authentication), the host→plugin requests (session / policy / context /
 * command) and the plugin→host round-trips (tool calls, interactive approvals).
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import type { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'

import type {
  BridgeCommandResult,
  BridgeContextUsage,
  BridgeHostRequestMap,
  BridgeNotificationMap,
  BridgePluginRequestMap,
  BridgeToolCallResult
} from '@cherrystudio/dsh-bridge'
import { loggerService } from '@logger'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { CherryToolMeta } from '@shared/data/types/uiParts'

import type { AgentRuntimeEvent } from '../types'
import { loadDshSdkProtocol } from './dshSdk'
import { DSH_TRANSPORT } from './dshStreamAdapter'

const logger = loggerService.withContext('DshBridgeServer')

const READY_TIMEOUT_MS = 15_000

export interface DshBridgeServerOptions {
  /** Agent-session id — keys the neutral approval registry so close()/abort target the right approvals. */
  sessionId: string
  /** Push a runtime-neutral event into the connection queue; the host owns presentation. */
  emit: (event: AgentRuntimeEvent) => void
  /** Resolve responder availability at ask-time so warm connections follow the current turn. */
  getInteractionState: () => { userResponse: 'stream' | 'message' | 'unavailable' }
  /** Dispatch one registered dsh native tool into Cherry's in-process MCP bridge. */
  onToolCall: (name: string, args: unknown, signal: AbortSignal) => Promise<BridgeToolCallResult>
  /** One subagent residency-epoch edge from the plugin's lifecycle listeners. */
  onSubagentLifecycle?: (edge: BridgeNotificationMap['subagent/lifecycle']) => void
  /** Deadline for an accepted socket to authenticate; also bounds `whenReady()`. */
  readyTimeoutMs?: number
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
  private transport?: JsonRpcLineTransport
  private readonly unauthenticatedSockets = new Set<net.Socket>()
  private readonly activeToolCalls = new Map<string, AbortController>()
  private ready = false
  private readonly readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  private closed = false
  private readonly readyTimeoutMs: number

  constructor(private readonly options: DshBridgeServerOptions) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS
  }

  async listen(): Promise<void> {
    // ESM-only class, loaded before the first connection so accepting stays synchronous.
    const { JsonRpcLineTransport } = await loadDshSdkProtocol()
    const server = net.createServer((socket) => this.handleConnection(socket, JsonRpcLineTransport))
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

  /** Resolves when the plugin's `ready` request authenticates (it connects as the composition boots). */
  whenReady(timeoutMs = this.readyTimeoutMs): Promise<void> {
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

  /** Send one control request; rejects with the plugin's error response. */
  request<M extends keyof BridgeHostRequestMap>(
    method: M,
    params: BridgeHostRequestMap[M]['params'],
    options?: { timeoutMs?: number }
  ): Promise<BridgeHostRequestMap[M]['result']> {
    const transport = this.transport
    if (!transport || !this.connection || this.connection.destroyed) {
      return Promise.reject(new Error('dsh bridge plugin is not connected'))
    }
    if (options?.timeoutMs === undefined) {
      return transport.request(method, params) as Promise<BridgeHostRequestMap[M]['result']>
    }
    // The transport has no timeouts; aborting drops the pending entry and rejects with this reason.
    const { timeoutMs } = options
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`dsh bridge ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    return (transport.request(method, params, controller.signal) as Promise<BridgeHostRequestMap[M]['result']>).finally(
      () => clearTimeout(timer)
    )
  }

  /** Query the plugin's `ctx.tokenMeter` measurement for this connection's session. */
  requestContextUsage(sessionId: string, options?: { timeoutMs?: number }): Promise<BridgeContextUsage> {
    return this.request('context/usage', { sessionId }, options).then((usage) => {
      if (typeof usage?.totalTokens !== 'number') throw new Error('dsh bridge returned no context usage payload')
      return usage
    })
  }

  /** Dispatch one slash-command line through the plugin's `ctx.commands` registry. No timeout —
   *  a command can wrap an LLM round-trip (compaction); a dead plugin rejects via socket close. */
  requestCommand(sessionId: string, line: string): Promise<BridgeCommandResult> {
    return this.request('command/execute', { sessionId, line })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Rejects every pending host→plugin request.
    this.transport?.close()
    this.transport = undefined
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

  private handleConnection(socket: net.Socket, Transport: typeof JsonRpcLineTransport): void {
    if (this.closed || this.connection) {
      socket.destroy()
      return
    }
    this.unauthenticatedSockets.add(socket)
    const transport = new Transport(socket, socket)
    let authenticated = false
    socket.setTimeout(this.readyTimeoutMs, () => socket.destroy())
    socket.on('error', (error) => logger.warn('dsh bridge socket error', { error }))
    socket.on('close', () => {
      this.unauthenticatedSockets.delete(socket)
      transport.close()
      if (this.connection === socket) {
        this.connection = undefined
        this.transport = undefined
        this.abortToolCalls()
      }
    })
    transport.onRequest(async (method, params) => {
      if (!authenticated) {
        if (method !== 'ready' || !this.authenticate(socket, transport, params)) {
          // Destroy after the error response is written so the peer can diagnose the denial.
          setImmediate(() => socket.destroy())
          throw new Error('dsh bridge authentication failed')
        }
        authenticated = true
        return {}
      }
      return this.handleRequest(method, params)
    })
    transport.onNotification((method, params) => {
      if (!authenticated) return
      if (method === 'tool/cancel') {
        const cancel = params as BridgeNotificationMap['tool/cancel']
        if (cancel.sessionId === this.options.sessionId) this.activeToolCalls.get(cancel.callId)?.abort()
        return
      }
      if (method === 'subagent/lifecycle') {
        this.options.onSubagentLifecycle?.(params as BridgeNotificationMap['subagent/lifecycle'])
      }
    })
    transport.start()
  }

  private authenticate(socket: net.Socket, transport: JsonRpcLineTransport, params: Record<string, unknown>): boolean {
    if (this.closed || this.connection) return false
    const { pid, token } = params as BridgePluginRequestMap['ready']['params']
    if (!Number.isSafeInteger(pid) || typeof token !== 'string') return false
    const expected = Buffer.from(this.authenticationToken)
    const received = Buffer.from(token)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false

    this.unauthenticatedSockets.delete(socket)
    socket.setTimeout(0)
    this.connection = socket
    this.transport = transport
    this.ready = true
    for (const waiter of this.readyWaiters.splice(0)) waiter.resolve()
    return true
  }

  private handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'tool/call':
        return this.handleToolCall(params as BridgePluginRequestMap['tool/call']['params'])
      case 'approval/ask':
        return this.handleApprovalAsk(params as BridgePluginRequestMap['approval/ask']['params'])
      case 'question/ask':
        return this.handleQuestionAsk(params as BridgePluginRequestMap['question/ask']['params'])
      default:
        return Promise.reject(new Error(`unknown dsh bridge method "${method}"`))
    }
  }

  private async handleToolCall(call: BridgePluginRequestMap['tool/call']['params']): Promise<BridgeToolCallResult> {
    if (call.sessionId !== this.options.sessionId) throw new Error('dsh bridge tool call used the wrong session')
    if (!call.callId || this.activeToolCalls.has(call.callId)) {
      throw new Error('dsh bridge tool call id is missing or already active')
    }
    const controller = new AbortController()
    this.activeToolCalls.set(call.callId, controller)
    try {
      return await this.options.onToolCall(call.name, call.args, controller.signal)
    } finally {
      if (this.activeToolCalls.get(call.callId) === controller) this.activeToolCalls.delete(call.callId)
    }
  }

  private handleApprovalAsk(
    ask: BridgePluginRequestMap['approval/ask']['params']
  ): Promise<BridgePluginRequestMap['approval/ask']['result']> {
    const toolName = ask.toolName
    const interactionState = this.options.getInteractionState()
    // Unattended turn — fail closed immediately (the wire carries no reason channel).
    if (interactionState.userResponse === 'unavailable') return Promise.resolve({ outcome: 'rejected' })

    const approvalId = randomUUID()
    const toolCallId = ask.callId || approvalId
    // `args` is protocol-`unknown` (plugin-parsed model output), so keep the shape guard.
    const input = isRecord(ask.args) ? ask.args : {}
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    return new Promise((resolve) => {
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
          const outcome = decision.approved && !decision.updatedInput ? 'allowed-once' : 'rejected'
          const rejectionReason = decision.approved ? undefined : decision.reason?.trim()
          resolve({ outcome, ...(rejectionReason ? { rejectionReason } : {}) })
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
    })
  }

  /**
   * One `ctx.userQuestions` ask. Only the plan-review intent is bridged: it lands
   * on the existing approval surface as an `exit_plan_mode` card. dsh's approve
   * check is byte-strict — exactly the intent's approve label and NO custom text;
   * any other answer (empty selection, optional feedback) means keep planning.
   */
  private handleQuestionAsk(
    ask: BridgePluginRequestMap['question/ask']['params']
  ): Promise<BridgePluginRequestMap['question/ask']['result']> {
    if (ask.sessionId !== this.options.sessionId) {
      return Promise.reject(new Error('dsh bridge question used the wrong session'))
    }
    const review = ask.questions.length === 1 ? ask.questions[0] : undefined
    const intent = review?.intent
    if (!review || intent?.kind !== 'plan-review' || typeof review.detail !== 'string') {
      return Promise.reject(new Error('only plan-review questions are bridged to the host'))
    }
    if (!ask.callId) return Promise.reject(new Error('dsh bridge plan review is missing its tool call id'))
    const interactionState = this.options.getInteractionState()
    if (interactionState.userResponse === 'unavailable') {
      return Promise.reject(new Error('no user is available to review the plan'))
    }
    const approvalId = randomUUID()
    const toolCallId = ask.callId
    const presentation = interactionState.userResponse === 'stream' ? 'stream' : 'message'
    const input = { plan: review.detail }
    return new Promise((resolve) => {
      const pending = toolApprovalRegistry.register({
        approvalId,
        sessionId: this.options.sessionId,
        toolCallId,
        toolName: 'exit_plan_mode',
        originalInput: { ...input },
        presentation,
        resolve: (decision) => {
          if (decision.approved && !decision.updatedInput) {
            resolve({ answers: [{ id: review.id, selected: [intent.approve] }] })
            return
          }
          const feedback = decision.reason?.trim()
          resolve({ answers: [{ id: review.id, selected: [], ...(feedback ? { custom: feedback } : {}) }] })
        }
      })
      if (!pending) return
      this.options.emit({
        type: 'tool-approval-request',
        request: {
          approvalId,
          toolCallId,
          toolName: 'exit_plan_mode',
          input: { ...input },
          presentation,
          providerMetadata: {
            cherry: { transport: DSH_TRANSPORT, toolName: 'exit_plan_mode' } satisfies CherryToolMeta
          }
        }
      })
    })
  }

  private abortToolCalls(): void {
    for (const controller of this.activeToolCalls.values()) controller.abort()
    this.activeToolCalls.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
