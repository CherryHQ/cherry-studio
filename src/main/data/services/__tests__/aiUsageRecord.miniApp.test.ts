import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { type AiUsageRecordSourceType, AiUsageRecordSourceTypeSchema } from '@shared/data/types/aiUsageRecord'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const A = 'com.example.mygame'

/**
 * A valid `ai_usage_record` row attributed to a mini app. Every NOT NULL column holds a
 * REAL enum member — `recordKind`/`modality`/`apiKeyAttribution` are CHECK-constrained,
 * so an invented value fails at INSERT, not at typecheck. The identity CHECKs also require
 * `providerId`/`modelId` for an `invocation` and `apiKeyId` for `explicit` attribution.
 */
const miniAppUsageRow = (appId: string, totalTokens: number) => ({
  requestId: `mini-app-usage-${appId}-${totalTokens}`,
  recordKind: 'invocation' as const,
  requestCount: 1,
  providerId: 'provider-1',
  modelId: 'model-1',
  modality: 'language' as const,
  apiKeyId: 'key-1',
  apiKeyAttribution: 'explicit' as const,
  sourceType: 'mini-app' as const satisfies AiUsageRecordSourceType,
  sourceId: appId,
  sourceName: appId,
  totalTokens,
  createdAt: Date.now()
})

describe('mini-app usage attribution', () => {
  // ONE call at describe scope: `setupTestDatabase` registers its own hooks, so
  // calling it inside an `it()` registers them after collection has started.
  const dbh = setupTestDatabase()

  it('accepts mini-app as a source type', () => {
    expect(AiUsageRecordSourceTypeSchema.options).toContain('mini-app')
  })

  it('stores a mini-app attributed record past the CHECK constraint', () => {
    // The bug this guards: adding the union member without regenerating the migration.
    // The CHECK is built at DDL time, so a stale table only rejects at INSERT.
    dbh.db.insert(aiUsageRecordTable).values(miniAppUsageRow(A, 1200)).run()

    const [row] = dbh.db.select().from(aiUsageRecordTable).all()
    expect(row.sourceType).toBe('mini-app')
    expect(row.sourceId).toBe(A)
  })
})
