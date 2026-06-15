import type { Options, WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { startup } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AiAgentSessionWarmCloseRequest, AiAgentSessionWarmRequest } from '@shared/ai/transport'
import { IpcChannel } from '@shared/IpcChannel'

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
}

function isValidSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.length > 0
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

export function createClaudeCodeWarmQuerySignature(options: Options): string {
  const stripped = stripWarmQueryOptions(options)
  const signatureSource = stripped.mcpServers
    ? { ...stripped, mcpServers: sanitizeMcpServersForSignature(stripped.mcpServers) }
    : stripped
  return JSON.stringify(normalizeForSignature(signatureSource))
}

@Injectable('ClaudeCodeWarmQueryManager')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeWarmQueryManager extends BaseService {
  private readonly entries = new Map<string, WarmQueryEntry>()

  protected onInit(): void {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Ai_AgentSession_Prewarm, async (_, req: AiAgentSessionWarmRequest) => {
      if (!isValidSessionId(req?.sessionId)) {
        logger.warn('Ignoring prewarm request with invalid sessionId', { sessionId: req?.sessionId })
        return
      }
      await this.prewarmAgentSession(req.sessionId)
    })

    this.ipcHandle(IpcChannel.Ai_AgentSession_CloseWarm, (_, req: AiAgentSessionWarmCloseRequest) => {
      if (!isValidSessionId(req?.sessionId)) {
        logger.warn('Ignoring close-warm request with invalid sessionId', { sessionId: req?.sessionId })
        return
      }
      this.closeAgentSessionWarm(req.sessionId)
    })
  }

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
    const signature = createClaudeCodeWarmQuerySignature(warmOptions)
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
    const signature = createClaudeCodeWarmQuerySignature(warmOptions)
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
