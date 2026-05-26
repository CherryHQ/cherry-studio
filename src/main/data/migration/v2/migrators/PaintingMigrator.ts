import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type { PaintingMode, PaintingProvider } from '@shared/data/types/painting'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysByScope } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PaintingMigrator')

type PaintingInsertRow = typeof paintingTable.$inferInsert

type LegacyPainting = Record<string, unknown> & {
  id?: unknown
  urls?: unknown
  files?: unknown
  providerId?: unknown
  model?: unknown
  prompt?: unknown
  negativePrompt?: unknown
  status?: unknown
  ppioStatus?: unknown
}

interface NamespaceMapping {
  provider: PaintingProvider
  mode: PaintingMode
  useLegacyProviderId?: boolean
}

const NAMESPACE_MAPPINGS = {
  siliconflow_paintings: { provider: 'silicon', mode: 'generate' },
  dmxapi_paintings: { provider: 'dmxapi', mode: 'generate' },
  tokenflux_paintings: { provider: 'tokenflux', mode: 'generate' },
  zhipu_paintings: { provider: 'zhipu', mode: 'generate' },
  aihubmix_image_generate: { provider: 'aihubmix', mode: 'generate' },
  aihubmix_image_remix: { provider: 'aihubmix', mode: 'remix' },
  aihubmix_image_edit: { provider: 'aihubmix', mode: 'edit' },
  aihubmix_image_upscale: { provider: 'aihubmix', mode: 'upscale' },
  openai_image_generate: { provider: 'new-api', mode: 'generate', useLegacyProviderId: true },
  openai_image_edit: { provider: 'new-api', mode: 'edit', useLegacyProviderId: true },
  ovms_paintings: { provider: 'ovms', mode: 'generate' },
  ppio_draw: { provider: 'ppio', mode: 'draw' },
  ppio_edit: { provider: 'ppio', mode: 'edit' }
} as const satisfies Record<string, NamespaceMapping>

const PUBLIC_KEYS = new Set([
  'id',
  'urls',
  'files',
  'providerId',
  'model',
  'prompt',
  'negativePrompt',
  'status',
  'ppioStatus'
])

export class PaintingMigrator extends BaseMigrator {
  readonly id = 'painting'
  readonly name = 'Paintings'
  readonly description = 'Migrate painting history to SQLite'
  readonly order = 5.4

  private preparedRows: Array<Omit<PaintingInsertRow, 'orderKey'> & { scopeKey: string }> = []
  private sourceCount = 0
  private skippedCount = 0

  override reset(): void {
    this.preparedRows = []
    this.sourceCount = 0
    this.skippedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const legacyState = ctx.sources.reduxState.getCategory<Record<string, unknown>>('paintings')
      if (!legacyState) {
        logger.info('paintings redux state not found, skipping')
        return { success: true, itemCount: 0, warnings: ['paintings redux state not found - skipping'] }
      }

      const rows: Array<Omit<PaintingInsertRow, 'orderKey'> & { scopeKey: string }> = []
      let sourceCount = 0
      let skippedCount = 0

      for (const [namespace, mapping] of Object.entries(NAMESPACE_MAPPINGS)) {
        const value = legacyState[namespace]
        if (!Array.isArray(value)) {
          continue
        }

        sourceCount += value.length
        for (const item of value) {
          const transformed = transformLegacyPainting(item, mapping)
          if (!transformed) {
            skippedCount += 1
            continue
          }
          rows.push(transformed)
        }
      }

      this.preparedRows = rows
      this.sourceCount = sourceCount
      this.skippedCount = skippedCount

      logger.info('Prepared painting migration', {
        sourceCount,
        preparedCount: rows.length,
        skippedCount
      })

      return {
        success: true,
        itemCount: rows.length,
        warnings: skippedCount > 0 ? [`Skipped ${skippedCount} invalid paintings`] : undefined
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Prepare failed', error as Error)
      return { success: false, itemCount: 0, error: message }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedRows.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const stamped = assignOrderKeysByScope(this.preparedRows, (row) => row.scopeKey)
      const rows: PaintingInsertRow[] = stamped.map(stripScopeKey)

      await ctx.db.transaction(async (tx) => {
        await tx.insert(paintingTable).values(rows)
      })

      logger.info('Painting migration completed', { processedCount: rows.length })
      return { success: true, processedCount: rows.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', error as Error)
      return { success: false, processedCount: 0, error: message }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []

    try {
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(paintingTable).get()
      const targetCount = result?.count ?? 0

      if (targetCount < this.preparedRows.length) {
        errors.push({
          key: 'painting_count_mismatch',
          expected: this.preparedRows.length,
          actual: targetCount,
          message: `Expected at least ${this.preparedRows.length} paintings, got ${targetCount}`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      errors.push({
        key: 'validation_error',
        message: error instanceof Error ? error.message : String(error)
      })
      return {
        success: false,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}

function stripScopeKey(
  row: Omit<PaintingInsertRow, 'orderKey'> & { scopeKey: string; orderKey: string }
): PaintingInsertRow {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    status: row.status,
    urls: row.urls,
    files: row.files,
    params: row.params,
    orderKey: row.orderKey
  }
}

function transformLegacyPainting(
  source: unknown,
  mapping: NamespaceMapping
): (Omit<PaintingInsertRow, 'orderKey'> & { scopeKey: string }) | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null
  }

  const painting = source as LegacyPainting
  if (typeof painting.id !== 'string') {
    return null
  }

  const provider =
    mapping.useLegacyProviderId && typeof painting.providerId === 'string' && painting.providerId.length > 0
      ? painting.providerId
      : mapping.provider
  const status = firstString(painting.status, painting.ppioStatus)

  return {
    id: painting.id,
    provider,
    mode: mapping.mode,
    model: typeof painting.model === 'string' ? painting.model : undefined,
    prompt: typeof painting.prompt === 'string' ? painting.prompt : undefined,
    negativePrompt: typeof painting.negativePrompt === 'string' ? painting.negativePrompt : undefined,
    status,
    urls: Array.isArray(painting.urls) ? painting.urls.filter((url): url is string => typeof url === 'string') : [],
    files: Array.isArray(painting.files) ? painting.files.filter(isLegacyFileMetadata) : [],
    params: extractParams(painting),
    scopeKey: `${provider}:${mapping.mode}`
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

function extractParams(painting: LegacyPainting): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(painting)) {
    if (!PUBLIC_KEYS.has(key) && value !== undefined) {
      params[key] = value
    }
  }
  return params
}

function isLegacyFileMetadata(value: unknown): value is FileMetadata {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<FileMetadata>
  return typeof file.id === 'string' && typeof file.name === 'string'
}
