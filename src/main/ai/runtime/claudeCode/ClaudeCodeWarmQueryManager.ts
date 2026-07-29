import type { Options, WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { startup } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { AgentSessionUsageCapture } from '../types'
import { buildClaudeCodeWarmQueryRequestForAgentSession } from './agentSessionWarmup'

const logger = loggerService.withContext('ClaudeCodeWarmQueryManager')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

type WarmQueryEntry = {
  signature: string
  promise: Promise<WarmQuery | undefined>
  usageCapture?: AgentSessionUsageCapture
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface WarmQueryRequest {
  key: string
  options: Options
  initializeTimeoutMs?: number
  /**
   * Rotation-insensitive identity of the credentials the options were built with (e.g. a hash of the
   * provider's enabled key SET). The selected key is stripped from the signature because prewarm and
   * consume materialize separately; this fingerprint still invalidates the warm process when the set
   * changes.
   */
  credentialsFingerprint?: string
  /** Capture policy for the credentials and route that actually started this warm process. */
  usageCapture?: AgentSessionUsageCapture
  /**
   * Effective knowledge scope (binding, else composer selection) baked into cherry-tools at startup.
   * It is signature material precisely because it is frozen here: a warm query built for one scope
   * must not be consumed by a turn that needs another. Prewarm runs with no composer selection, so a
   * prewarmed entry carries binding-only scope and deliberately misses for a scoped turn.
   */
  knowledgeBaseIds?: readonly string[]
}

export interface ConsumedWarmQuery {
  warmQuery: WarmQuery
  usageCapture?: AgentSessionUsageCapture
}

export function stripWarmQueryOptions(options: Options): Options {
  const {
    // oxlint-disable-next-line no-unused-vars
    abortController: _abortController,
    // oxlint-disable-next-line no-unused-vars
    steerHolder: _steerHolder,
    ...rest
  } = options as Options & { steerHolder?: unknown }
  return rest as Options
}

function normalizeForSignature(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? '[function]' : value
  }
  if (typeof value === 'function') return '[function]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSignature(item, seen))
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))

  return Object.fromEntries(entries.map(([key, item]) => [key, normalizeForSignature(item, seen)]))
}

/**
 * Replace each MCP server's live `instance` (a circular `McpServer` SDK object)
 * with a stable `{ type, name }` descriptor so the signature is built from a
 * serializable subset instead of deep-normalizing the live SDK object graph.
 */
function sanitizeMcpServersForSignature(mcpServers: Options['mcpServers']): unknown {
  if (!mcpServers || typeof mcpServers !== 'object') return mcpServers
  const sanitized: Record<string, unknown> = {}
  for (const [key, config] of Object.entries(mcpServers)) {
    if (config && typeof config === 'object' && 'instance' in config) {
      const rest = { ...(config as Record<string, unknown>) }
      delete rest.instance
      sanitized[key] = rest
    } else {
      sanitized[key] = config
    }
  }
  return sanitized
}

const CREDENTIAL_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * Drop the injected credential env vars from the signature source WITHOUT mutating the caller's
 * options — `stripWarmQueryOptions` shallow-copies, so `env` is shared with the live spawn options.
 */
function stripCredentialEnvForSignature(options: Options): Options {
  const env = options.env
  if (!env || !CREDENTIAL_ENV_KEYS.some((key) => key in env)) return options
  const cleanedEnv = { ...env }
  for (const key of CREDENTIAL_ENV_KEYS) delete cleanedEnv[key]
  return { ...options, env: cleanedEnv }
}

export function createClaudeCodeWarmQuerySignature(
  options: Options,
  credentialsFingerprint?: string,
  knowledgeBaseIds: readonly string[] = []
): string {
  const stripped = stripCredentialEnvForSignature(stripWarmQueryOptions(options))
  const signatureSource = stripped.mcpServers
    ? { ...stripped, mcpServers: sanitizeMcpServersForSignature(stripped.mcpServers) }
    : stripped
  return JSON.stringify({
    options: normalizeForSignature(signatureSource),
    credentials: credentialsFingerprint ?? null,
    knowledgeBaseIds: [...knowledgeBaseIds].sort()
  })
}

@Injectable('ClaudeCodeWarmQueryManager')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeWarmQueryManager extends BaseService {
  private readonly entries = new Map<string, WarmQueryEntry>()
  private readonly pauseHolds = new Set<symbol>()
  private readonly resumeWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>()
  private readonly deferredPrewarms = new Map<string, WarmQueryRequest>()
  private readonly inFlightStartups = new Map<Promise<WarmQuery | undefined>, string>()
  private stopping = false

  // `ai.agent.session.prewarm` / `ai.agent.session.close_warm` (IpcApi, validated by the router)
  // delegate to the public methods below; this service registers no IPC of its own.

  async prewarmAgentSession(sessionId: string): Promise<void> {
    await this.waitForResume()
    if (application.get('ClaudeCodeTraceBridgeService').isTraceModeEnabled()) {
      this.closeAll()
      return
    }

    try {
      const warmRequest = await buildClaudeCodeWarmQueryRequestForAgentSession(sessionId)
      if (!warmRequest) return
      this.prewarm(warmRequest)
    } catch (error) {
      logger.warn('Failed to prewarm agent session', { sessionId, error })
    }
  }

  closeAgentSessionWarm(sessionId: string): void {
    try {
      this.close(sessionId)
    } catch (error) {
      logger.debug('Failed to close agent session warm query', { sessionId, error })
    }
  }

  prewarm(request: WarmQueryRequest): void {
    if (this.stopping) return
    if (this.isWriteQuiesced) {
      // Only the newest request for a session matters; starting every superseded warm
      // process after resume would waste resources and immediately close the older one.
      this.deferredPrewarms.set(request.key, request)
      return
    }

    const warmOptions = stripWarmQueryOptions(request.options)
    const signature = createClaudeCodeWarmQuerySignature(
      warmOptions,
      request.credentialsFingerprint,
      request.knowledgeBaseIds
    )
    const existing = this.entries.get(request.key)

    if (existing?.signature === signature) {
      this.refreshIdleTimer(request.key, existing)
      return
    }

    if (existing) {
      this.closeEntry(existing)
    }

    const promise = startup({ options: warmOptions, initializeTimeoutMs: request.initializeTimeoutMs }).catch(
      (error) => {
        if (this.entries.get(request.key)?.promise === promise) {
          this.entries.delete(request.key)
        }
        logger.warn('Claude warm query startup failed', { key: request.key, error })
        return undefined
      }
    )
    this.inFlightStartups.set(promise, request.key)
    void promise.then(
      () => this.inFlightStartups.delete(promise),
      () => this.inFlightStartups.delete(promise)
    )

    const entry: WarmQueryEntry = { signature, promise, usageCapture: request.usageCapture }
    this.entries.set(request.key, entry)
    this.refreshIdleTimer(request.key, entry)
  }

  async consume(request: WarmQueryRequest): Promise<ConsumedWarmQuery | undefined> {
    const warmOptions = stripWarmQueryOptions(request.options)
    const signature = createClaudeCodeWarmQuerySignature(
      warmOptions,
      request.credentialsFingerprint,
      request.knowledgeBaseIds
    )
    const entry = this.entries.get(request.key)
    if (!entry) return undefined

    this.entries.delete(request.key)
    if (entry.idleTimer) clearTimeout(entry.idleTimer)

    if (entry.signature !== signature) {
      this.closeEntry(entry)
      return undefined
    }

    const warmQuery = await entry.promise
    if (!warmQuery) return undefined
    return { warmQuery, usageCapture: entry.usageCapture }
  }

  close(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.closeEntry(entry)
  }

  closeAll(): void {
    const entries = [...this.entries.values()]
    this.entries.clear()
    for (const entry of entries) this.closeEntry(entry)
  }

  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'claude-warm-query-pause')
    this.pauseHolds.add(token)
    logger.info('Claude warm-query admission paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('Claude warm-query pause hold released', {
          reason: reason ?? null,
          holds: this.pauseHolds.size
        })
        if (this.pauseHolds.size > 0 || this.stopping) return

        const waiters = [...this.resumeWaiters]
        this.resumeWaiters.clear()
        for (const waiter of waiters) waiter.resolve()

        const deferred = [...this.deferredPrewarms.values()]
        this.deferredPrewarms.clear()
        for (const request of deferred) this.prewarm(request)
      }
    }
  }

  async drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    if (!this.isWriteQuiesced) {
      logger.warn('drainInFlight called without an active pause hold — the verdict is a point-in-time snapshot')
    }

    const seen = new WeakSet<Promise<unknown>>()
    const pending = new Map<Promise<unknown>, string>()
    const collect = (): void => {
      for (const [startupPromise, key] of this.inFlightStartups) {
        if (seen.has(startupPromise)) continue
        seen.add(startupPromise)
        pending.set(startupPromise, `warm-start:${key}`)
        const remove = () => pending.delete(startupPromise)
        startupPromise.then(remove, remove)
      }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    try {
      for (;;) {
        collect()
        if (pending.size === 0) return { stragglerIds: [] }
        const winner = await Promise.race([
          Promise.allSettled([...pending.keys()]).then(() => 'done' as const),
          timeout
        ])
        if (winner === 'timeout') {
          const stragglerIds = [...new Set(pending.values())]
          logger.warn('Claude warm-query drain timed out', { timeoutMs: opts.timeoutMs, stragglerIds })
          return { stragglerIds }
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [...this.inFlightStartups.values()].map((key) => ({
      id: `warm-start:${key}`,
      summary: 'warm query starting'
    }))
  }

  protected onInit(): void {
    this.stopping = false
  }

  protected onStop(): void {
    this.stopping = true
    this.deferredPrewarms.clear()
    const waiters = [...this.resumeWaiters]
    this.resumeWaiters.clear()
    for (const waiter of waiters) waiter.reject(new Error('ClaudeCodeWarmQueryManager is stopping'))
    this.closeAll()
  }

  protected onDestroy(): void {
    this.closeAll()
  }

  private refreshIdleTimer(key: string, entry: WarmQueryEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      if (this.entries.get(key) !== entry) return
      this.entries.delete(key)
      this.closeEntry(entry)
    }, DEFAULT_IDLE_TTL_MS)
    entry.idleTimer.unref?.()
  }

  private waitForResume(): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('ClaudeCodeWarmQueryManager is stopping'))
    if (!this.isWriteQuiesced) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      this.resumeWaiters.add({ resolve, reject })
    })
  }

  private closeEntry(entry: WarmQueryEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    void entry.promise
      .then((warmQuery) => {
        warmQuery?.close()
      })
      .catch((error) => {
        logger.debug('Ignoring warm query close after failed startup', { error })
      })
  }
}
