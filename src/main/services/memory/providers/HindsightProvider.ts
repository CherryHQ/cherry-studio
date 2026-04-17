/**
 * HindsightProvider — memory provider backed by a Hindsight server
 * (self-hosted Docker or Hindsight Cloud; same API, different base URL / key).
 *
 * API mapping (mem0-style DTO ↔ Hindsight API):
 *   add(content, opts)    → client.retain / client.retainBatch
 *   search(query, opts)   → client.recall
 *   reflect(opts)         → client.reflect
 *   list(opts)            → client.listMemories
 *   get(id)               → N/A — Hindsight has no single-item fetch;
 *                           falls back to listMemories + find
 *   update(id, …)         → not supported by Hindsight client; throws
 *   delete(id)            → not supported by Hindsight client; throws
 *   deleteAll(opts)       → not supported by Hindsight client; throws
 *   listUsers()           → returns the bank prefix as a synthetic user
 *   healthCheck()         → GET /health on the base URL
 *
 * The active configuration is read from preferences on every operation so
 * settings changes take effect immediately without restarting the service.
 *
 * Bank-id resolution:
 *   global       → '<prefix>'
 *   per_user     → '<prefix>-<userId>'
 *   per_assistant → '<prefix>-<agentId>'
 *   per_topic    → '<prefix>-<topicId>'
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  AddMemoryOptions,
  BankStrategy,
  MemoryDeleteAllOptions,
  MemoryEntity,
  MemoryItem,
  MemoryListOptions,
  MemoryProviderCapabilities,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryUser,
  ReflectOptions,
  ReflectResult
} from '@shared/memory'
import type { MemoryProvider } from '@shared/memory/provider'

const logger = loggerService.withContext('HindsightProvider')

// Typed reference to the Hindsight client — imported lazily so the module
// is only loaded when the provider is actually activated.
type HindsightClientType = {
  retain(bankId: string, content: string, options?: Record<string, unknown>): Promise<unknown>
  retainBatch(
    bankId: string,
    items: { content: string; context?: string }[],
    options?: Record<string, unknown>
  ): Promise<unknown>
  recall(
    bankId: string,
    query: string,
    options?: Record<string, unknown>
  ): Promise<{
    results: Array<{
      id?: string
      text: string
      type?: string
      score?: number
      metadata?: Record<string, unknown>
      created_at?: string
    }>
  }>
  reflect(
    bankId: string,
    query: string,
    options?: Record<string, unknown>
  ): Promise<{ text: string; structured?: unknown }>
  listMemories(
    bankId: string,
    options?: Record<string, unknown>
  ): Promise<{
    results?: Array<{
      id?: string
      content?: string
      text?: string
      type?: string
      metadata?: Record<string, unknown>
      created_at?: string
    }>
  }>
  createBank(bankId: string, options?: Record<string, unknown>): Promise<unknown>
}

/** Circuit-breaker: how many consecutive failures before we stop retrying. */
const CIRCUIT_BREAKER_THRESHOLD = 5

export class HindsightProvider implements MemoryProvider {
  readonly id = 'hindsight'

  readonly capabilities: MemoryProviderCapabilities = {
    supportsReflect: true,
    supportsMentalModels: true,
    supportsBanks: true,
    serverSideExtraction: true
  }

  private client: HindsightClientType | null = null
  private consecutiveFailures = 0
  private circuitOpen = false

  async init(): Promise<void> {
    this.client = await this.buildClient()
    // Sync capabilities.supportsReflect from preference.
    const reflectEnabled = this.pref('feature.memory.hindsight.reflect_enabled') as boolean
    ;(this.capabilities as { supportsReflect: boolean }).supportsReflect = reflectEnabled
    logger.info('HindsightProvider initialised')
  }

  async add(content: string | string[], options?: AddMemoryOptions): Promise<MemoryItem[]> {
    const client = this.requireClient()
    const bankId = this.resolveBankId(options)

    if (Array.isArray(content)) {
      const items = content.map((c) => ({ content: c }))
      await this.exec(() =>
        client.retainBatch(bankId, items, {
          async: true,
          metadata: options?.metadata
        })
      )
    } else {
      await this.exec(() =>
        client.retain(bankId, content, {
          timestamp: options?.timestamp ? new Date(options.timestamp) : undefined,
          metadata: options?.metadata,
          async: true
        })
      )
    }

    // Hindsight retain is async; return a synthetic item so callers get
    // consistent typing without waiting for server-side extraction.
    return [
      {
        id: `hindsight-${Date.now()}`,
        memory: Array.isArray(content) ? content.join('\n') : content,
        createdAt: new Date().toISOString(),
        metadata: options?.metadata
      }
    ]
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult> {
    const client = this.requireClient()
    const bankId = this.resolveBankId(options)

    const response = await this.exec(() =>
      client.recall(bankId, query, {
        maxTokens: 4096,
        budget: 'high',
        limit: options?.limit
      })
    )

    const results = (response?.results ?? []).map((r) => this.mapRecallResult(r))
    return { results }
  }

  async reflect(options: ReflectOptions): Promise<ReflectResult> {
    const client = this.requireClient()
    const bankId = this.resolveBankId(options)

    const response = await this.exec(() =>
      client.reflect(bankId, options.query, {
        budget: 'high',
        maxTokens: options.maxTokens
      })
    )

    return {
      content: response?.text ?? '',
      structured: response?.structured
    }
  }

  async list(options?: MemoryListOptions): Promise<MemoryItem[]> {
    const client = this.requireClient()
    const bankId = this.resolveBankId(options)

    const response = await this.exec(() =>
      client.listMemories(bankId, {
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0
      })
    )

    return (response?.results ?? []).map((r) => this.mapListResult(r))
  }

  async get(id: string): Promise<MemoryItem | null> {
    // Hindsight doesn't have a single-item fetch; use listMemories + find.
    const client = this.requireClient()
    const bankId = this.resolveBankId({})

    const response = await this.exec(() => client.listMemories(bankId, { q: id, limit: 10 }))

    const match = (response?.results ?? []).find((r) => r.id === id)
    return match ? this.mapListResult(match) : null
  }

  async update(_id: string, _memory: string): Promise<MemoryItem> {
    throw new Error('Hindsight does not support direct memory updates. Add new content to retain updated information.')
  }

  async delete(_id: string): Promise<void> {
    throw new Error(
      'Hindsight does not support direct memory deletion via this client. Use the Hindsight UI or API directly.'
    )
  }

  async deleteAll(_options?: MemoryDeleteAllOptions): Promise<void> {
    throw new Error('Hindsight does not support bulk delete via this client. Use the Hindsight UI or API directly.')
  }

  async listUsers(): Promise<MemoryUser[]> {
    const prefix = this.pref('feature.memory.hindsight.default_bank_prefix') as string
    const userId = this.pref('feature.memory.current_user_id') as string
    return [{ userId: `${prefix}-${userId}` }]
  }

  async healthCheck(): Promise<boolean> {
    try {
      const rawUrl = this.pref('feature.memory.hindsight.base_url') as string
      const apiKey = this.pref('feature.memory.hindsight.api_key') as string
      const timeoutMs = (this.pref('feature.memory.hindsight.timeout_ms') as number) ?? 10000

      const baseUrl = rawUrl.replace(/\/+$/, '')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      const headers: Record<string, string> = { Accept: 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

      const res = await fetch(`${baseUrl}/health`, { signal: controller.signal, headers })
      clearTimeout(timer)

      if (!res.ok) {
        logger.warn(`Hindsight health check failed: HTTP ${res.status} ${res.statusText}`)
      }
      return res.ok
    } catch (err) {
      logger.warn('Hindsight health check failed', err as Error)
      return false
    }
  }

  async destroy(): Promise<void> {
    this.client = null
    this.consecutiveFailures = 0
    this.circuitOpen = false
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async buildClient(): Promise<HindsightClientType> {
    // Lazy import so the module is only loaded when this provider activates.

    const { HindsightClient } = await import('@vectorize-io/hindsight-client')
    const rawUrl = this.pref('feature.memory.hindsight.base_url') as string
    const apiKey = this.pref('feature.memory.hindsight.api_key') as string

    // Strip trailing slashes so SDK path concatenation works correctly.
    const baseUrl = rawUrl.replace(/\/+$/, '')

    // Warn if the user entered an MCP endpoint instead of the REST API base.
    if (baseUrl.includes('/mcp')) {
      logger.warn(
        "HindsightProvider: baseUrl contains '/mcp' — this looks like an MCP endpoint. " +
          'Cherry Studio uses the Hindsight REST API. Use the server root URL instead ' +
          '(e.g. https://api.hindsight.example.com or http://localhost:8888).'
      )
    }

    const config: { baseUrl: string; apiKey?: string } = { baseUrl }
    if (apiKey) config.apiKey = apiKey

    return new HindsightClient(config) as HindsightClientType
  }

  private requireClient(): HindsightClientType {
    if (this.circuitOpen) {
      throw new Error(
        'HindsightProvider circuit breaker is open due to repeated failures. Check your Hindsight server connection.'
      )
    }
    if (!this.client) {
      throw new Error('HindsightProvider not initialised. Call init() first.')
    }
    return this.client
  }

  private async exec<T>(fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn()
      // Reset on success.
      this.consecutiveFailures = 0
      this.circuitOpen = false
      return result
    } catch (err) {
      this.consecutiveFailures++
      if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        this.circuitOpen = true
        logger.error(
          `HindsightProvider circuit breaker opened after ${CIRCUIT_BREAKER_THRESHOLD} failures`,
          err as Error
        )
      } else {
        logger.warn('HindsightProvider operation failed', err as Error)
      }
      throw err
    }
  }

  private resolveBankId(entity?: Partial<MemoryEntity>): string {
    const prefix = (this.pref('feature.memory.hindsight.default_bank_prefix') as string) || 'cherry'
    const strategy = (this.pref('feature.memory.bank_strategy') as BankStrategy) || 'per_user'
    const userId = (this.pref('feature.memory.current_user_id') as string) || 'default-user'

    switch (strategy) {
      case 'global':
        return prefix
      case 'per_user':
        return `${prefix}-${entity?.userId ?? userId}`
      case 'per_assistant':
        return `${prefix}-agent-${entity?.agentId ?? 'default'}`
      case 'per_topic':
        return `${prefix}-topic-${entity?.topicId ?? entity?.runId ?? 'default'}`
      default:
        return `${prefix}-${userId}`
    }
  }

  private pref(key: string): unknown {
    return application.get('PreferenceService').get(key as never)
  }

  private mapRecallResult(r: {
    id?: string
    text: string
    type?: string
    score?: number
    metadata?: Record<string, unknown>
    created_at?: string
  }): MemoryItem {
    return {
      id: r.id ?? `hindsight-${Date.now()}-${Math.random()}`,
      memory: r.text,
      score: r.score,
      metadata: { ...r.metadata, _type: r.type },
      createdAt: r.created_at
    }
  }

  private mapListResult(r: {
    id?: string
    content?: string
    text?: string
    type?: string
    metadata?: Record<string, unknown>
    created_at?: string
  }): MemoryItem {
    return {
      id: r.id ?? `hindsight-${Date.now()}-${Math.random()}`,
      memory: r.content ?? r.text ?? '',
      metadata: { ...r.metadata, _type: r.type },
      createdAt: r.created_at
    }
  }
}
