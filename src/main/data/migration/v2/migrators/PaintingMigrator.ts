import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { FileEntryIdSchema, paintingSourceType } from '@shared/data/types/file'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type { PaintingMode, PaintingProvider } from '@shared/data/types/painting'
import { inArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysByScope } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PaintingMigrator')
const FILE_REF_INSERT_BATCH_SIZE = 500
const INARRAY_CHUNK = 500
const PAINTING_FILE_ROLE = 'image'

type PaintingInsertRow = typeof paintingTable.$inferInsert
type PreparedPaintingRow = Omit<PaintingInsertRow, 'id' | 'orderKey'> & {
  id: string
  scopeKey: string
  fileEntryIds: string[]
}

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

  private preparedRows: PreparedPaintingRow[] = []
  private sourceCount = 0
  private skippedCount = 0
  private fileRefInsertCount = 0
  private fileRefSkippedCount = 0
  private expectedFileRefCount = 0

  override reset(): void {
    this.preparedRows = []
    this.sourceCount = 0
    this.skippedCount = 0
    this.fileRefInsertCount = 0
    this.fileRefSkippedCount = 0
    this.expectedFileRefCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const legacyState = ctx.sources.reduxState.getCategory<Record<string, unknown>>('paintings')
      if (!legacyState) {
        logger.info('paintings redux state not found, skipping')
        return { success: true, itemCount: 0, warnings: ['paintings redux state not found - skipping'] }
      }

      const rows: PreparedPaintingRow[] = []
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
      this.expectedFileRefCount = countExpectedFileRefs(stamped)
      const migratedFileEntryIds = await loadMigratedFileEntryIds(ctx, collectFileEntryIds(stamped))
      const fileRefRows = buildFileRefRows(stamped, migratedFileEntryIds, (message) => {
        this.fileRefSkippedCount += 1
        logger.warn(message)
      })

      await ctx.db.transaction(async (tx) => {
        await tx.insert(paintingTable).values(rows)
        for (let i = 0; i < fileRefRows.length; i += FILE_REF_INSERT_BATCH_SIZE) {
          await tx.insert(fileRefTable).values(fileRefRows.slice(i, i + FILE_REF_INSERT_BATCH_SIZE))
        }
      })

      this.fileRefInsertCount = fileRefRows.length
      logger.info('Painting migration completed', {
        processedCount: rows.length,
        fileRefsInserted: this.fileRefInsertCount,
        fileRefsSkipped: this.fileRefSkippedCount
      })
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
      const fileRefResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(fileRefTable)
        .where(sql`${fileRefTable.sourceType} = ${paintingSourceType} AND ${fileRefTable.role} = ${PAINTING_FILE_ROLE}`)
        .get()
      const targetFileRefCount = fileRefResult?.count ?? 0

      if (targetCount < this.preparedRows.length) {
        errors.push({
          key: 'painting_count_mismatch',
          expected: this.preparedRows.length,
          actual: targetCount,
          message: `Expected at least ${this.preparedRows.length} paintings, got ${targetCount}`
        })
      }

      if (this.fileRefSkippedCount > 0) {
        errors.push({
          key: 'painting_file_ref_skipped',
          expected: this.expectedFileRefCount,
          actual: this.fileRefInsertCount,
          message: `Skipped ${this.fileRefSkippedCount} painting file references during migration`
        })
      }

      if (targetFileRefCount < this.expectedFileRefCount) {
        errors.push({
          key: 'painting_file_ref_count_mismatch',
          expected: this.expectedFileRefCount,
          actual: targetFileRefCount,
          message: `Expected at least ${this.expectedFileRefCount} painting file refs, got ${targetFileRefCount}`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount,
          skippedCount: this.skippedCount
        },
        diagnostics: {
          fileRefsExpected: this.expectedFileRefCount,
          fileRefsInserted: this.fileRefInsertCount,
          fileRefsSkipped: this.fileRefSkippedCount,
          fileRefsTargetCount: targetFileRefCount
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
        },
        diagnostics: {
          fileRefsExpected: this.expectedFileRefCount,
          fileRefsInserted: this.fileRefInsertCount,
          fileRefsSkipped: this.fileRefSkippedCount
        }
      }
    }
  }
}

function stripScopeKey(row: PreparedPaintingRow & { orderKey: string }): PaintingInsertRow {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    status: row.status,
    urls: row.urls,
    params: row.params,
    orderKey: row.orderKey
  }
}

function transformLegacyPainting(source: unknown, mapping: NamespaceMapping): PreparedPaintingRow | null {
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

  const files = Array.isArray(painting.files) ? painting.files.filter(isLegacyFileMetadata) : []

  return {
    id: painting.id,
    provider,
    mode: mapping.mode,
    model: typeof painting.model === 'string' ? painting.model : undefined,
    prompt: typeof painting.prompt === 'string' ? painting.prompt : undefined,
    negativePrompt: typeof painting.negativePrompt === 'string' ? painting.negativePrompt : undefined,
    status,
    urls: Array.isArray(painting.urls) ? painting.urls.filter((url): url is string => typeof url === 'string') : [],
    params: extractParams(painting),
    fileEntryIds: files.map((file) => file.id),
    scopeKey: `${provider}:${mapping.mode}`
  }
}

function collectFileEntryIds(rows: readonly PreparedPaintingRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    for (const id of row.fileEntryIds) {
      if (FileEntryIdSchema.safeParse(id).success) {
        ids.add(id)
      }
    }
  }
  return [...ids]
}

function countExpectedFileRefs(rows: readonly PreparedPaintingRow[]): number {
  let count = 0
  for (const row of rows) {
    const deduped = new Set<string>()
    for (const id of row.fileEntryIds) {
      if (FileEntryIdSchema.safeParse(id).success && !deduped.has(id)) {
        deduped.add(id)
        count += 1
      }
    }
  }
  return count
}

async function loadMigratedFileEntryIds(ctx: MigrationContext, fileEntryIds: readonly string[]): Promise<Set<string>> {
  const migrated = new Set<string>()
  if (fileEntryIds.length === 0) return migrated

  for (let i = 0; i < fileEntryIds.length; i += INARRAY_CHUNK) {
    const chunk = fileEntryIds.slice(i, i + INARRAY_CHUNK)
    const rows = await ctx.db
      .select({ id: fileEntryTable.id })
      .from(fileEntryTable)
      .where(inArray(fileEntryTable.id, chunk))
    for (const row of rows) migrated.add(row.id)
  }

  return migrated
}

function buildFileRefRows(
  paintings: readonly PreparedPaintingRow[],
  migratedFileEntryIds: ReadonlySet<string>,
  onSkipped: (message: string) => void
): Array<typeof fileRefTable.$inferInsert> {
  const rows: Array<typeof fileRefTable.$inferInsert> = []
  const now = Date.now()

  for (const painting of paintings) {
    const deduped = new Set<string>()
    for (const fileEntryId of painting.fileEntryIds) {
      if (!FileEntryIdSchema.safeParse(fileEntryId).success) {
        onSkipped(`Painting id=${painting.id} references malformed file_entry id=${fileEntryId}; file_ref skipped`)
        continue
      }
      if (!migratedFileEntryIds.has(fileEntryId)) {
        onSkipped(
          `Painting id=${painting.id} references file_entry id=${fileEntryId} which is absent from v2 file_entry; file_ref skipped`
        )
        continue
      }
      if (deduped.has(fileEntryId)) continue
      deduped.add(fileEntryId)
      const timestamp = now + rows.length
      rows.push({
        id: uuidv4(),
        fileEntryId,
        sourceType: paintingSourceType,
        sourceId: painting.id,
        role: PAINTING_FILE_ROLE,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    }
  }

  return rows
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
