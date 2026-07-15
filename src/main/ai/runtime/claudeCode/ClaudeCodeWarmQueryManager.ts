import type { Options, WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { startup } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { buildClaudeCodeWarmQueryRequestForAgentSession } from './agentSessionWarmup'

const logger = loggerService.withContext('ClaudeCodeWarmQueryManager')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

type WarmQueryEntry = {
  signature: string
  promise: Promise<WarmQuery | undefined>
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface WarmQueryRequest {
  key: string
  options: Options
  initializeTimeoutMs?: number
  /**
   * Rotation-insensitive identity of the credentials the options were built with (e.g. a hash of the
   * provider's enabled key SET). The raw rotated key is stripped from the signature — `getRotatedApiKey`
   * advances per build, so prewarm/consume would otherwise never match on multi-key providers — while
   * this fingerprint keeps the signature sensitive to the key set actually changing.
   */
  credentialsFingerprint?: string
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

export function createClaudeCodeWarmQuerySignature(options: Options, credentialsFingerprint?: string): string {
  const stripped = stripCredentialEnvForSignature(stripWarmQueryOptions(options))
  const signatureSource = stripped.mcpServers
    ? { ...stripped, mcpServers: sanitizeMcpServersForSignature(stripped.mcpServers) }
    : stripped
  return JSON.stringify({
    options: normalizeForSignature(signatureSource),
    credentials: credentialsFingerprint ?? null
  })
}

@Injectable('ClaudeCodeWarmQueryManager')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeWarmQueryManager extends BaseService {
  private readonly entries = new Map<string, WarmQueryEntry>()

  // `ai.prewarm_agent_session` / `ai.close_agent_session_warm` (IpcApi, validated by the router)
  // delegate to the public methods below; this service registers no IPC of its own.

  async prewarmAgentSession(sessionId: string): Promise<void> {
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
    const warmOptions = stripWarmQueryOptions(request.options)
    const signature = createClaudeCodeWarmQuerySignature(warmOptions, request.credentialsFingerprint)
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

    const entry: WarmQueryEntry = { signature, promise }
    this.entries.set(request.key, entry)
    this.refreshIdleTimer(request.key, entry)
  }

  async consume(request: WarmQueryRequest): Promise<WarmQuery | undefined> {
    const warmOptions = stripWarmQueryOptions(request.options)
    const signature = createClaudeCodeWarmQuerySignature(warmOptions, request.credentialsFingerprint)
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
    return warmQuery
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

  protected onStop(): void {
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
