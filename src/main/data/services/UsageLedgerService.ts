/**
 * Usage Ledger Service - durable per-message usage/cost records
 *
 * The ledger is the billing source of truth: append-only snapshots that
 * survive deletion of the message, topic, provider, and API key they
 * describe (the table has no foreign keys by design).
 *
 * Rows are recorded from the DATA layer — `MessageService.update` fires
 * `recordFromMessage` when an assistant message lands token stats. The AI
 * streaming pipeline is not involved and never imports this service.
 *
 * API key attribution is resolved here, best-effort, from ProviderService
 * state at write time (the pipeline does not thread the chosen key through):
 * - exactly one enabled key        → `exact` (rotation always returns it)
 * - multiple enabled keys          → `rotation` (round-robin pointer; with
 *   concurrent requests to the same provider, or unrelated rotation callers
 *   like model-list refresh, the pointer may have moved — treat as
 *   "probable", not guaranteed)
 * - IAM / keyless OAuth credential → `auth`
 * - otherwise                      → `none` (no keys, pointer lost on
 *   restart, or key deleted before persist)
 *
 * Upsert semantics: usage/cost columns are last-write-wins; key-identity
 * columns keep the EARLIEST non-`none` attribution (it was resolved closest
 * to request time and is the most trustworthy).
 */

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { type InsertUsageLedgerRow, type UsageLedgerRow, usageLedgerTable } from '@data/db/schemas/usageLedger'
import { loggerService } from '@logger'
import type {
  UsageLedgerListQuery,
  UsageLedgerListResponse,
  UsageLedgerStatsBucket,
  UsageLedgerStatsQuery,
  UsageLedgerStatsResponse
} from '@shared/data/api/schemas/usageLedger'
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { UsageLedgerAttribution, UsageLedgerEntry } from '@shared/data/types/usageLedger'
import { maskApiKey } from '@shared/utils/api'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { providerService } from './ProviderService'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:UsageLedgerService')

type UsageLedgerCursor = { createdAt: number; id: string } | null

/** The message fields the ledger needs — callers may pass a full `Message`. */
export type UsageLedgerMessageInput = Pick<Message, 'id' | 'topicId' | 'role' | 'modelId' | 'stats'>

interface KeyAttribution {
  attribution: UsageLedgerAttribution
  keyId?: string
  label?: string
  masked?: string
}

function decodeCursor(raw: string | undefined): UsageLedgerCursor {
  if (!raw) return null

  // `<= 0` also rejects ":id" — Number('') is 0, which would silently match
  // nothing instead of falling back to the first page.
  const separator = raw.indexOf(':')
  if (separator <= 0) return warnAndFallback(raw, 'missing or empty createdAt segment')

  const createdAt = Number(raw.slice(0, separator))
  const id = raw.slice(separator + 1)
  if (!Number.isFinite(createdAt) || !id) {
    return warnAndFallback(raw, 'malformed createdAt or id')
  }

  return { createdAt, id }
}

function warnAndFallback(raw: string, reason: string): UsageLedgerCursor {
  logger.warn('decodeCursor: cursor unparseable, falling back to first page', { cursor: raw, reason })
  return null
}

function encodeCursor(row: UsageLedgerRow): string {
  return `${row.createdAt}:${row.id}`
}

function rowToEntry(row: UsageLedgerRow): UsageLedgerEntry {
  return {
    id: row.id,
    messageId: row.messageId,
    topicId: row.topicId,
    providerId: row.providerId,
    modelId: row.modelId,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: row.apiKeyLabel,
    apiKeyMasked: row.apiKeyMasked,
    apiKeyAttribution: row.apiKeyAttribution as UsageLedgerAttribution,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    reasoningTokens: row.reasoningTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    cost: row.cost,
    costCurrency: row.costCurrency,
    costSource: row.costSource as UsageLedgerEntry['costSource'],
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Provider-level credentials that never flow through the apiKeys array. */
const AUTH_CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['iam-aws', 'iam-gcp', 'iam-azure'])

/**
 * Mask a key for the durable snapshot. `maskApiKey` passes keys of ≤8 chars
 * through unmasked (fine for transient UI, not for a row that outlives the
 * key) — clamp those to a fixed placeholder so the raw secret is never stored.
 */
function maskKeyForSnapshot(key: string): string {
  const masked = maskApiKey(key)
  return masked === key ? '****' : masked
}

/** True when the stats blob carries something worth billing. */
function hasUsageSignal(stats: NonNullable<Message['stats']>): boolean {
  return (
    stats.inputTokens !== undefined ||
    stats.outputTokens !== undefined ||
    stats.totalTokens !== undefined ||
    stats.cost !== undefined
  )
}

/** Project the persisted `MessageStats` onto the ledger's usage/cost columns. */
function statsToColumns(stats: NonNullable<Message['stats']>) {
  return {
    inputTokens: stats.inputTokens ?? null,
    outputTokens: stats.outputTokens ?? null,
    totalTokens: stats.totalTokens ?? null,
    reasoningTokens: stats.reasoningTokens ?? null,
    cacheReadTokens: stats.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: stats.inputTokenDetails?.cacheWriteTokens ?? null,
    cost: stats.cost ?? null,
    costCurrency: stats.costCurrency ?? null,
    costSource: stats.costSource ?? null
  }
}

export class UsageLedgerService {
  /**
   * Record (upsert) the ledger row for an assistant message that landed
   * token stats. Idempotent on `messageId`: usage/cost columns are
   * last-write-wins on re-persists (retries, continue-after-tool-approval);
   * key-identity columns keep the earliest non-`none` attribution. No-op for
   * rows without any usage signal.
   *
   * Known limitation: a continue-after-tool-approval run restarts the
   * pipeline's usage accumulator, so the re-persisted `message.stats` (and
   * therefore this row) reflects the continuation leg only — the same
   * under-count is visible on the message itself. Fixing that belongs
   * upstream in the stream pipeline, not here.
   *
   * Best-effort by contract: callers fire-and-forget; failures must never
   * disrupt message persistence.
   */
  async recordFromMessage(message: UsageLedgerMessageInput): Promise<void> {
    if (message.role !== 'assistant') return

    const stats = message.stats
    if (!stats || !hasUsageSignal(stats)) return

    if (!message.modelId) return
    let providerId: string
    try {
      ;({ providerId } = parseUniqueModelId(message.modelId as `${string}::${string}`))
    } catch {
      logger.warn('recordFromMessage: unparseable modelId, skipping', { modelId: message.modelId })
      return
    }

    const key = await this.resolveKeyAttribution(providerId)

    const values = {
      messageId: message.id,
      topicId: message.topicId ?? null,
      providerId,
      modelId: message.modelId ?? null,
      apiKeyId: key.keyId ?? null,
      apiKeyLabel: key.label ?? null,
      apiKeyMasked: key.masked ?? null,
      apiKeyAttribution: key.attribution,
      ...statsToColumns(stats)
    }

    // In the DO UPDATE branch, an unqualified/table-qualified column reads the
    // EXISTING row and `excluded.*` reads the proposed insert. Key-identity
    // columns keep the stored attribution unless it is 'none' — the first
    // resolution happened closest to request time and is the most accurate;
    // a later 'none' (pointer lost on restart) must not downgrade it.
    const keepStored = sql`${usageLedgerTable.apiKeyAttribution} <> 'none'`
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx
        .insert(usageLedgerTable)
        .values(values)
        .onConflictDoUpdate({
          target: usageLedgerTable.messageId,
          set: {
            ...values,
            apiKeyId: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyId} ELSE excluded.api_key_id END`,
            apiKeyLabel: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyLabel} ELSE excluded.api_key_label END`,
            apiKeyMasked: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyMasked} ELSE excluded.api_key_masked END`,
            apiKeyAttribution: sql`CASE WHEN ${keepStored} THEN ${usageLedgerTable.apiKeyAttribution} ELSE excluded.api_key_attribution END`,
            // $onUpdateFn does not fire on conflict-update paths — stamp explicitly.
            updatedAt: Date.now()
          }
        })
    })

    logger.debug('Recorded usage ledger entry', {
      messageId: message.id,
      providerId,
      attribution: key.attribution
    })
  }

  /**
   * Best-effort API key attribution for a provider at write time.
   * See the class doc for the exact/rotation/auth/none semantics.
   */
  async resolveKeyAttribution(providerId: string): Promise<KeyAttribution> {
    let authType: string
    let allKeysCount = 0
    try {
      const provider = await providerService.getByProviderId(providerId)
      authType = provider.authType
      allKeysCount = provider.apiKeys.length
    } catch {
      // Provider deleted between request and persist.
      return { attribution: 'none' }
    }

    if (AUTH_CREDENTIAL_TYPES.has(authType)) {
      return { attribution: 'auth' }
    }

    let allKeys: Awaited<ReturnType<typeof providerService.getApiKeys>>
    try {
      allKeys = allKeysCount > 0 ? await providerService.getApiKeys(providerId) : []
    } catch {
      return { attribution: 'none' }
    }
    const enabled = allKeys.filter((k) => k.isEnabled)

    if (enabled.length === 0) {
      // OAuth providers without API keys authenticate via their token
      // (e.g. claude-code CLI login); plain api-key providers with no keys
      // (local endpoints) are simply unattributable.
      return authType === 'oauth' ? { attribution: 'auth' } : { attribution: 'none' }
    }

    if (enabled.length === 1) {
      // Rotation short-circuits on a single enabled key — deterministic.
      const k = enabled[0]
      return { attribution: 'exact', keyId: k.id, label: k.label, masked: maskKeyForSnapshot(k.key) }
    }

    // Multiple keys: the rotation pointer holds the id most recently handed
    // out for this provider. Match against ALL keys — the key may have been
    // disabled or relabeled between use and persist.
    const lastUsedKeyId = providerService.getLastUsedApiKeyId(providerId)
    if (lastUsedKeyId) {
      const k = allKeys.find((entry) => entry.id === lastUsedKeyId)
      if (k) {
        return { attribution: 'rotation', keyId: k.id, label: k.label, masked: maskKeyForSnapshot(k.key) }
      }
    }
    return { attribution: 'none' }
  }

  // ── Reconciliation ────────────────────────────────────────────────

  private reconcilePromise: Promise<void> | undefined

  /**
   * Once per process, before serving reads: backfill ledger rows for
   * assistant messages that carry stats but have no ledger row. Covers
   * v1-migrated history and writes lost to crashes/quits (both bypass or
   * outrun the live hook). Failures are logged and retried on the next read.
   */
  private ensureReconciled(): Promise<void> {
    this.reconcilePromise ??= this.reconcileFromMessages()
      .then((count) => {
        if (count > 0) logger.info('usage ledger reconciliation backfilled rows', { count })
      })
      .catch((err) => {
        logger.warn('usage ledger reconciliation failed; will retry on next read', { err })
        this.reconcilePromise = undefined
      })
    return this.reconcilePromise
  }

  /**
   * Insert ledger rows for stats-bearing assistant messages that have none.
   * Timestamps mirror the message's own `createdAt` (usage time, not
   * reconcile time) so time-windowed stats stay meaningful. Existing rows are
   * never touched (`onConflictDoNothing`).
   *
   * Attribution: the serving key was never recorded, so this is a guess at
   * best — providers with exactly ONE configured key get that key with the
   * explicit `backfill` confidence; everything else is honest `none`
   * (attributing multi-key history to an arbitrary key would corrupt per-key
   * billing).
   *
   * Reads `message` cross-service but read-only — the write stays on the
   * ledger's own table.
   */
  async reconcileFromMessages(): Promise<number> {
    const db = application.get('DbService').getDb()

    const missing = await db
      .select({
        id: messageTable.id,
        topicId: messageTable.topicId,
        modelId: messageTable.modelId,
        stats: messageTable.stats,
        createdAt: messageTable.createdAt
      })
      .from(messageTable)
      .leftJoin(usageLedgerTable, eq(messageTable.id, usageLedgerTable.messageId))
      .where(
        and(
          eq(messageTable.role, 'assistant'),
          isNotNull(messageTable.stats),
          isNotNull(messageTable.modelId),
          isNull(usageLedgerTable.id)
        )
      )

    const attributionByProvider = new Map<string, KeyAttribution>()
    const rows: InsertUsageLedgerRow[] = []

    for (const m of missing) {
      if (!m.stats || !hasUsageSignal(m.stats) || !m.modelId) continue
      let providerId: string
      try {
        ;({ providerId } = parseUniqueModelId(m.modelId as `${string}::${string}`))
      } catch {
        continue
      }

      let key = attributionByProvider.get(providerId)
      if (!key) {
        key = await this.resolveBackfillAttribution(providerId)
        attributionByProvider.set(providerId, key)
      }

      rows.push({
        messageId: m.id,
        topicId: m.topicId,
        providerId,
        modelId: m.modelId,
        apiKeyId: key.keyId ?? null,
        apiKeyLabel: key.label ?? null,
        apiKeyMasked: key.masked ?? null,
        apiKeyAttribution: key.attribution,
        ...statsToColumns(m.stats),
        createdAt: m.createdAt,
        updatedAt: m.createdAt
      })
    }

    if (rows.length === 0) return 0

    // Chunked to stay well under SQLite's bind-parameter limit.
    const CHUNK = 100
    await application.get('DbService').withWriteTx(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx
          .insert(usageLedgerTable)
          .values(rows.slice(i, i + CHUNK))
          .onConflictDoNothing({ target: usageLedgerTable.messageId })
      }
    })

    return rows.length
  }

  /**
   * Attribution for reconciled rows. Unlike live resolution there is no
   * rotation pointer to consult — only the provider's current key inventory.
   */
  private async resolveBackfillAttribution(providerId: string): Promise<KeyAttribution> {
    let authType: string
    try {
      authType = (await providerService.getByProviderId(providerId)).authType
    } catch {
      return { attribution: 'none' }
    }

    if (AUTH_CREDENTIAL_TYPES.has(authType)) {
      return { attribution: 'auth' }
    }

    let allKeys: Awaited<ReturnType<typeof providerService.getApiKeys>>
    try {
      allKeys = await providerService.getApiKeys(providerId)
    } catch {
      return { attribution: 'none' }
    }

    if (allKeys.length === 1) {
      const k = allKeys[0]
      return { attribution: 'backfill', keyId: k.id, label: k.label, masked: maskKeyForSnapshot(k.key) }
    }
    if (allKeys.length === 0 && authType === 'oauth') {
      return { attribution: 'auth' }
    }
    return { attribution: 'none' }
  }

  async list(query: UsageLedgerListQuery): Promise<UsageLedgerListResponse> {
    await this.ensureReconciled()

    const db = application.get('DbService').getDb()
    const { limit } = query

    const filterConditions: SQL[] = []
    if (query.providerId !== undefined) filterConditions.push(eq(usageLedgerTable.providerId, query.providerId))
    if (query.apiKeyId !== undefined) filterConditions.push(eq(usageLedgerTable.apiKeyId, query.apiKeyId))
    if (query.from !== undefined) filterConditions.push(gte(usageLedgerTable.createdAt, query.from))
    if (query.to !== undefined) filterConditions.push(lte(usageLedgerTable.createdAt, query.to))

    const conditions = [...filterConditions]
    const cursor = decodeCursor(query.cursor)
    if (cursor) {
      conditions.push(
        or(
          lt(usageLedgerTable.createdAt, cursor.createdAt),
          and(eq(usageLedgerTable.createdAt, cursor.createdAt), gt(usageLedgerTable.id, cursor.id))
        )!
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(usageLedgerTable)
        .where(where)
        .orderBy(desc(usageLedgerTable.createdAt), asc(usageLedgerTable.id))
        .limit(limit + 1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(usageLedgerTable)
        .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
    ])
    const pageRows = rows.slice(0, limit)

    return {
      items: pageRows.map(rowToEntry),
      total: count,
      nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : undefined
    }
  }

  async stats(query: UsageLedgerStatsQuery): Promise<UsageLedgerStatsResponse> {
    await this.ensureReconciled()

    const db = application.get('DbService').getDb()

    const conditions: SQL[] = []
    if (query.providerId !== undefined) conditions.push(eq(usageLedgerTable.providerId, query.providerId))
    if (query.from !== undefined) conditions.push(gte(usageLedgerTable.createdAt, query.from))
    if (query.to !== undefined) conditions.push(lte(usageLedgerTable.createdAt, query.to))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    // costCurrency always participates in the group key — USD and CNY must
    // never be summed into one number.
    const groupColumns =
      query.groupBy === 'apiKey'
        ? [usageLedgerTable.providerId, usageLedgerTable.apiKeyId, usageLedgerTable.costCurrency]
        : query.groupBy === 'model'
          ? [usageLedgerTable.providerId, usageLedgerTable.modelId, usageLedgerTable.costCurrency]
          : [usageLedgerTable.providerId, usageLedgerTable.costCurrency]

    const rows = await db
      .select({
        providerId: usageLedgerTable.providerId,
        apiKeyId: usageLedgerTable.apiKeyId,
        modelId: usageLedgerTable.modelId,
        costCurrency: usageLedgerTable.costCurrency,
        // Representative display fields (rows in one key bucket share them in
        // practice; max() just picks a stable value if labels changed).
        apiKeyLabel: sql<string | null>`max(${usageLedgerTable.apiKeyLabel})`,
        apiKeyMasked: sql<string | null>`max(${usageLedgerTable.apiKeyMasked})`,
        apiKeyAttribution: sql<string>`max(${usageLedgerTable.apiKeyAttribution})`,
        totalCost: sql<number>`coalesce(sum(${usageLedgerTable.cost}), 0)`,
        totalInputTokens: sql<number>`coalesce(sum(${usageLedgerTable.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${usageLedgerTable.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${usageLedgerTable.totalTokens}), 0)`,
        entryCount: sql<number>`count(*)`
      })
      .from(usageLedgerTable)
      .where(where)
      .groupBy(...groupColumns)
      .orderBy(sql`coalesce(sum(${usageLedgerTable.cost}), 0) desc`)

    const buckets: UsageLedgerStatsBucket[] = rows.map((row) => ({
      providerId: row.providerId,
      costCurrency: row.costCurrency,
      totalCost: row.totalCost,
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
      totalTokens: row.totalTokens,
      entryCount: row.entryCount,
      ...(query.groupBy === 'apiKey'
        ? {
            apiKeyId: row.apiKeyId,
            apiKeyLabel: row.apiKeyLabel,
            apiKeyMasked: row.apiKeyMasked,
            apiKeyAttribution: row.apiKeyAttribution as UsageLedgerAttribution
          }
        : {}),
      ...(query.groupBy === 'model' ? { modelId: row.modelId } : {})
    }))

    return { buckets }
  }
}

export const usageLedgerService = new UsageLedgerService()
