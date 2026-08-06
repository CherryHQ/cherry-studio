import { createHash } from 'node:crypto'

import type { Options, WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { startup } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { BaseService, Injectable, LifecycleEvents, Phase, ServicePhase } from '@main/core/lifecycle'
import { deriveRootSpanId } from '@shared/data/types/trace'

import { buildAgentSessionTopicId } from '../../agentSession/topic'
import type { AgentSessionUsageCapture } from '../types'
import { buildClaudeCodeWarmQueryRequestForAgentSession } from './agentSessionWarmup'
import { claudeCodeProcessManager, spawnClaudeCodeProcess } from './ClaudeCodeProcessManager'

const logger = loggerService.withContext('ClaudeCodeWarmQueryManager')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

type WarmQueryEntry = {
  signature: string
  promise: Promise<WarmQuery | undefined>
  closePromise?: Promise<void>
  usageCapture?: AgentSessionUsageCapture
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface WarmQueryRequest {
  key: string
  options: Options
  initializeTimeoutMs?: number
  /**
   * Rotation-insensitive identity of the auth/header material the options were built with (e.g. a
   * hash of the provider's enabled key SET and custom headers). The raw rotated key is stripped from
   * the signature — `getRotatedApiKey` advances per build, so prewarm/consume would otherwise never
   * match on multi-key providers — while this fingerprint keeps the signature sensitive to the
   * underlying connection material actually changing.
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

const ROTATING_CREDENTIAL_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const
const HASHED_CREDENTIAL_ENV_KEYS = ['ANTHROPIC_CUSTOM_HEADERS'] as const

/**
 * Remove rotating API keys and hash custom headers in the signature source WITHOUT mutating the
 * caller's options. Header changes must invalidate a parked query, but their potentially-secret raw
 * values must not be retained in the in-memory signature.
 */
function sanitizeSensitiveEnvForSignature(options: Options): Options {
  const env = options.env
  const hasSensitiveEnv =
    env &&
    (ROTATING_CREDENTIAL_ENV_KEYS.some((key) => key in env) || HASHED_CREDENTIAL_ENV_KEYS.some((key) => key in env))
  if (!env || !hasSensitiveEnv) return options

  const cleanedEnv = { ...env }
  for (const key of ROTATING_CREDENTIAL_ENV_KEYS) delete cleanedEnv[key]
  for (const key of HASHED_CREDENTIAL_ENV_KEYS) {
    const value = cleanedEnv[key]
    if (value !== undefined) {
      cleanedEnv[key] = createHash('sha256').update(value).digest('hex')
    }
  }
  return { ...options, env: cleanedEnv }
}

export function createClaudeCodeWarmQuerySignature(
  options: Options,
  credentialsFingerprint?: string,
  knowledgeBaseIds: readonly string[] = []
): string {
  const stripped = sanitizeSensitiveEnvForSignature(stripWarmQueryOptions(options))
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
  private applicationShutdownPromise?: Promise<void>

  // `ai.agent.session.prewarm` / `ai.agent.session.close_warm` (IpcApi, validated by the router)
  // delegate to the public methods below; this service registers no IPC of its own.

  protected onInit(): void {
    const lifecycleManager = application.getLifecycleManager()
    // stopAll awaits services serially. Start the bounded process timeline at its boundary so an
    // earlier slow service cannot consume the application's force-exit budget first.
    const startApplicationShutdown = () => {
      if (!application.isQuitting) return
      lifecycleManager.off(LifecycleEvents.BEFORE_STOP_ALL, startApplicationShutdown)
      void this.startApplicationShutdown()
    }
    lifecycleManager.on(LifecycleEvents.BEFORE_STOP_ALL, startApplicationShutdown)
    this.registerDisposable(() => lifecycleManager.off(LifecycleEvents.BEFORE_STOP_ALL, startApplicationShutdown))
  }

  async prewarmAgentSession(sessionId: string): Promise<void> {
    try {
      const warmRequest = await buildClaudeCodeWarmQueryRequestForAgentSession(sessionId)
      if (!warmRequest) return
      this.prewarm(await this.withTraceEnv(sessionId, warmRequest))
    } catch (error) {
      logger.warn('Failed to prewarm agent session', { sessionId, error })
    }
  }

  /**
   * Spawn the parked subprocess into the session's container trace. Telemetry env is fixed at spawn
   * and is part of the warm signature, so a park built without it can never serve a traced turn —
   * prewarm and the turn must derive the same env or trace mode never gets a warm start.
   *
   * Everything the turn's trace context contributes to env is derivable from the session id alone:
   * the trace id is persisted on the session row and the root span id is derived from it. `modelName`
   * is left out because it never reaches env — the turn registers the real one at connect.
   */
  private async withTraceEnv(sessionId: string, request: WarmQueryRequest): Promise<WarmQueryRequest> {
    const traceBridge = application.get('ClaudeCodeTraceBridgeService')
    if (!traceBridge.isTraceModeEnabled()) return request

    const traceId = agentSessionService.ensureTraceId(sessionId)
    const traceEnv = await traceBridge.prepareTrace({
      topicId: buildAgentSessionTopicId(sessionId),
      traceId,
      rootSpanId: deriveRootSpanId(traceId),
      sessionId,
      turnId: ''
    })
    if (!traceEnv) return request

    return { ...request, options: { ...request.options, env: { ...request.options.env, ...traceEnv } } }
  }

  closeAgentSessionWarm(sessionId: string): void {
    void this.close(sessionId).catch((error) => {
      logger.debug('Failed to close agent session warm query', { sessionId, error })
    })
  }

  prewarm(request: WarmQueryRequest): void {
    const warmOptions = { ...stripWarmQueryOptions(request.options), spawnClaudeCodeProcess }
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
      void this.closeEntry(existing)
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

    const entry: WarmQueryEntry = { signature, promise, usageCapture: request.usageCapture }
    this.entries.set(request.key, entry)
    this.refreshIdleTimer(request.key, entry)
  }

  async consume(request: WarmQueryRequest): Promise<ConsumedWarmQuery | undefined> {
    const warmOptions = { ...stripWarmQueryOptions(request.options), spawnClaudeCodeProcess }
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
      void this.closeEntry(entry)
      return undefined
    }

    const warmQuery = await entry.promise
    if (!warmQuery) return undefined
    return { warmQuery, usageCapture: entry.usageCapture }
  }

  close(key: string): Promise<void> {
    const entry = this.entries.get(key)
    if (!entry) return Promise.resolve()
    this.entries.delete(key)
    return this.closeEntry(entry)
  }

  closeAll(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    return Promise.allSettled(entries.map((entry) => this.closeEntry(entry))).then(() => undefined)
  }

  protected onStop(): Promise<void> {
    if (!application.isQuitting) return this.closeAll()
    return this.startApplicationShutdown()
  }

  protected onDestroy(): Promise<void> {
    return this.closeAll()
  }

  private startApplicationShutdown(): Promise<void> {
    if (!this.applicationShutdownPromise) {
      this.applicationShutdownPromise = claudeCodeProcessManager.shutdown(async () => {
        const closings: Promise<unknown>[] = [this.closeAll()]
        try {
          closings.push(application.get('AgentSessionRuntimeService').closeAll())
        } catch (error) {
          logger.warn('Failed to start agent runtime shutdown', { error })
        }
        await Promise.allSettled(closings)
      })
    }
    return this.applicationShutdownPromise
  }

  private refreshIdleTimer(key: string, entry: WarmQueryEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = setTimeout(() => {
      if (this.entries.get(key) !== entry) return
      this.entries.delete(key)
      void this.closeEntry(entry)
    }, DEFAULT_IDLE_TTL_MS)
    entry.idleTimer.unref?.()
  }

  private closeEntry(entry: WarmQueryEntry): Promise<void> {
    if (entry.closePromise) return entry.closePromise
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.closePromise = entry.promise
      .then(async (warmQuery) => {
        await warmQuery?.[Symbol.asyncDispose]()
      })
      .catch((error) => {
        logger.debug('Ignoring warm query close after failed startup', { error })
      })
    return entry.closePromise
  }
}
