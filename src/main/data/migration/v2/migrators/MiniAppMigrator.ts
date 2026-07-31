/**
 * MiniApp migrator - migrates legacy Redux and sidecar configurations to SQLite
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'

import { miniAppLogoFileRefTable } from '@data/db/schemas/fileRelations'
import type { InsertMiniAppRow, MiniAppStatus } from '@data/db/schemas/miniApp'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { sql } from 'drizzle-orm'

import { loggerService } from '@logger'
import { MINI_APP_ID_REGEX } from '@shared/data/api/schemas/miniApps'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { miniAppLogoRef } from '@shared/data/types/file'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysByScope } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import { transformMiniApp } from './mappings/MiniAppMappings'
import {
  type EntityImageRef,
  insertPreparedImageEntryTx,
  insertPreparedImageRefTx,
  prepareBase64ImageFileEntry,
  type PreparedEntityImageFile,
  unlinkPreparedImages
} from './utils/logoMigration'

type MiniAppRowWithoutOrderKey = Omit<InsertMiniAppRow, 'orderKey'>
type LegacyCustomMiniApp = Record<string, unknown> & { id: string }

const logger = loggerService.withContext('MiniAppMigrator')

function orderKeyScopeForStatus(status: MiniAppStatus | undefined): 'visible' | 'disabled' {
  return status === 'disabled' ? 'disabled' : 'visible'
}

function createSafeLegacyMiniAppId(legacyId: string, reservedIds: Set<string>): string {
  let attempt = 0

  while (true) {
    const hashInput = attempt === 0 ? legacyId : `${legacyId}\0${attempt}`
    const candidate = `legacy-${createHash('sha256').update(hashInput).digest('hex')}`
    if (!reservedIds.has(candidate)) {
      reservedIds.add(candidate)
      return candidate
    }
    attempt++
  }
}

/** The mini-app logo slot for a given appId (mirrors MiniAppService). */
function miniAppLogoSlot(appId: string) {
  return { sourceType: miniAppLogoRef.sourceType, sourceId: appId, role: 'logo' }
}

export class MiniAppMigrator extends BaseMigrator {
  readonly id = 'miniapp'
  readonly name = 'MiniApp'
  readonly description = 'Migrate miniapp configurations from Redux and custom-minapps.json to SQLite'
  readonly order = 1.2

  private preparedRows: InsertMiniAppRow[] = []
  private skippedCount = 0
  private originalSourceCount = 0

  override reset(): void {
    this.preparedRows = []
    this.skippedCount = 0
    this.originalSourceCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedRows = []
    this.skippedCount = 0
    this.originalSourceCount = 0

    try {
      const warnings: string[] = []
      const state = ctx.sources.reduxState.getCategory<{
        enabled?: Record<string, unknown>[]
        disabled?: Record<string, unknown>[]
        pinned?: Record<string, unknown>[]
      }>('minapps')

      // custom-minapps.json is v1's authoritative store for complete custom
      // app records. Redux carries list membership/status and may be absent or
      // stale because v1 writes this file before dispatching the Redux update.
      const {
        apps: customApps,
        isAuthoritativeSnapshot,
        invalidCount: invalidCustomAppCount,
        warnings: customAppWarnings
      } = await loadCustomMiniApps(ctx.paths.customMiniAppsFile)
      warnings.push(...customAppWarnings)
      this.skippedCount += invalidCustomAppCount

      // Copy every Redux group before supplementing it so the source object is
      // never mutated during prepare().
      const groups: { data: Record<string, unknown>[]; status: MiniAppStatus }[] = [
        { data: [...(state?.enabled ?? [])], status: 'enabled' },
        { data: [...(state?.disabled ?? [])], status: 'disabled' },
        { data: [...(state?.pinned ?? [])], status: 'pinned' }
      ]

      const customAppsById = new Map<string, LegacyCustomMiniApp>()
      let duplicateCustomAppCount = 0
      for (const customApp of customApps) {
        if (customAppsById.has(customApp.id)) {
          duplicateCustomAppCount++
          warnings.push(`Skipped duplicate custom app in custom-minapps.json: ${customApp.id}`)
          continue
        }
        customAppsById.set(customApp.id, customApp)
      }
      this.skippedCount += duplicateCustomAppCount

      const reduxIds = new Set<string>()
      for (const group of groups) {
        for (const app of group.data) {
          if (app && typeof app.id === 'string' && app.id.length > 0) {
            reduxIds.add(app.id)
          }
        }
      }

      // A sidecar-only record has no Redux status. Restore it as enabled and
      // append it in file order, matching v1's custom-app list behavior.
      const sidecarOnlyApps = [...customAppsById.values()].filter((app) => !reduxIds.has(app.id))
      groups[0].data.push(...sidecarOnlyApps)

      // Count Redux entries plus only the sidecar records that represent
      // otherwise-missing entities. Sidecar copies of Redux entities are the
      // same logical source record, not additional items.
      this.originalSourceCount =
        groups.reduce((total, group) => total + group.data.length, 0) + invalidCustomAppCount + duplicateCustomAppCount

      // Reserve all already-valid source IDs before remapping invalid custom
      // IDs so a generated legacy hash can never shadow a real source row.
      const reservedIds = new Set<string>()
      for (const group of groups) {
        for (const app of group.data) {
          if (app && typeof app.id === 'string' && MINI_APP_ID_REGEX.test(app.id)) {
            reservedIds.add(app.id)
          }
        }
      }
      const remappedCustomIds = new Map<string, string>()

      // Track seen target IDs to detect duplicates across groups. A pinned app
      // also appears in enabled, so process it first and keep the higher status.
      const seenIds = new Map<string, MiniAppRowWithoutOrderKey>()

      // Process pinned first (highest priority), then enabled, then disabled
      const priorityOrder: MiniAppStatus[] = ['pinned', 'enabled', 'disabled']

      for (const status of priorityOrder) {
        const group = groups.find((g) => g.status === status)
        if (!group) continue

        for (const app of group.data) {
          if (!app || typeof app !== 'object' || Array.isArray(app) || !app.id || typeof app.id !== 'string') {
            this.skippedCount++
            warnings.push(`Skipped ${status} app without valid id: ${app?.name ?? 'unknown'}`)
            continue
          }

          const originalId = app.id
          const customApp = customAppsById.get(originalId)

          // v1 writes custom-minapps.json before updating Redux. If the app
          // crashes after a deletion reaches the file but before Redux
          // persists, Redux can still contain a stale custom record. Only a
          // complete sidecar has authoritative membership; malformed entries
          // may hide custom records that Redux can still recover.
          if (isAuthoritativeSnapshot && app.type === 'Custom' && !customApp) {
            this.skippedCount++
            warnings.push(`Skipped stale Redux custom app absent from custom-minapps.json: ${originalId}`)
            continue
          }

          const source: Record<string, unknown> = customApp ? { ...customApp, type: 'Custom' } : { ...app }

          if (!MINI_APP_ID_REGEX.test(originalId)) {
            if (source.type !== 'Custom') {
              this.skippedCount++
              warnings.push(`Skipped ${status} app with invalid id format: ${originalId}`)
              continue
            }

            let remappedId = remappedCustomIds.get(originalId)
            if (!remappedId) {
              remappedId = createSafeLegacyMiniAppId(originalId, reservedIds)
              remappedCustomIds.set(originalId, remappedId)
              warnings.push(`Remapped custom app id "${originalId}" to "${remappedId}"`)
            }
            source.id = remappedId
          }

          try {
            const row = transformMiniApp(source, status)

            // All rows must have name and url populated (full data + delta tracking).
            if (!row.name || !row.url) {
              this.skippedCount++
              warnings.push(`Skipped ${status} app ${originalId}: missing name or url`)
              continue
            }

            // Status groups are processed from highest to lowest priority, so
            // an existing row always wins. The duplicate is counted as skipped
            // so the engine's
            // `targetCount >= sourceCount - skippedCount` invariant holds —
            // pinned apps in v1 also appear in `enabled`, inflating sourceCount.
            const existing = seenIds.get(row.appId)
            if (!existing) {
              seenIds.set(row.appId, row)
            } else {
              this.skippedCount++
            }
          } catch (err) {
            this.skippedCount++
            const errMsg = err instanceof Error ? err.message : String(err)
            warnings.push(`Failed to transform ${status} app ${app.id}: ${errMsg}`)
            logger.warn(`Skipping ${status} app ${app.id}`, err instanceof Error ? err : new Error(errMsg))
          }
        }
      }

      // Stamp orderKey in the same visible/hidden scopes used by runtime writes.
      const rowsWithoutOrder: MiniAppRowWithoutOrderKey[] = [...seenIds.values()]
      this.preparedRows = assignOrderKeysByScope(rowsWithoutOrder, (row) =>
        orderKeyScopeForStatus(row.status)
      ) as InsertMiniAppRow[]

      const byStatus = {
        enabled: this.preparedRows.filter((r) => r.status === 'enabled').length,
        disabled: this.preparedRows.filter((r) => r.status === 'disabled').length,
        pinned: this.preparedRows.filter((r) => r.status === 'pinned').length
      }

      logger.info('Preparation completed', {
        appCount: this.preparedRows.length,
        skipped: this.skippedCount,
        byStatus
      })

      return {
        success: true,
        itemCount: this.preparedRows.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedRows.length === 0) {
      return { success: true, processedCount: 0 }
    }

    const logoFiles: PreparedEntityImageFile<EntityImageRef>[] = []
    try {
      let processed = 0

      const BATCH_SIZE = 100

      // Promote any base64 data-URL logo to an on-disk WebP file_entry + logo
      // ref row (the single source of truth); base64 never stays on logoKey,
      // which is nulled. A non-data-URL logoKey (url / icon ref) is left as-is.
      for (const row of this.preparedRows) {
        if (row.logoKey?.startsWith('data:')) {
          const logoFile = await prepareBase64ImageFileEntry(
            ctx.paths.filesDataDir,
            miniAppLogoSlot(row.appId),
            row.logoKey,
            // Ref-backed slot (`mini_app_logo`), same as the live `bindLogoImage`
            // path: reclaim when the mini-app is deleted or its logo replaced.
            'delete_when_unreferenced'
          )
          row.logoKey = null
          if (logoFile) logoFiles.push(logoFile)
        }
      }

      ctx.db.transaction((tx) => {
        // Insert file_entries first (the ref rows' `file_entry_id` FK needs
        // them), then the owner rows, then the ref rows (whose `source_id` FK
        // needs the owner) — see logoRef ordering.
        for (const logoFile of logoFiles) {
          insertPreparedImageEntryTx(tx, logoFile)
        }

        for (let i = 0; i < this.preparedRows.length; i += BATCH_SIZE) {
          const batch = this.preparedRows.slice(i, i + BATCH_SIZE)
          tx.insert(miniAppTable).values(batch).run()
          processed += batch.length
        }

        for (const logoFile of logoFiles) {
          insertPreparedImageRefTx(tx, logoFile)
        }
      })

      // Self-check the logo ref table's FKs (fileEntryId → file_entry, sourceId →
      // mini_app) now that both sides are inserted — FK enforcement is off during
      // migration, so this catches referential errors early (v2-migration-guide.md).
      this.assertOwnedForeignKeys(ctx.db, [miniAppLogoFileRefTable])

      this.reportProgress(100, `Migrated ${processed} miniApps`, {
        key: 'migration.progress.migrated_miniapps',
        params: { processed, total: this.preparedRows.length }
      })

      logger.info('Execute completed', { processedCount: processed })

      return { success: true, processedCount: processed }
    } catch (error) {
      // The WebP files are written before the tx; unlink them so a rolled-back
      // transaction leaves no orphans behind for the retry.
      await unlinkPreparedImages(logoFiles)
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const result = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(miniAppTable)
        .get()
      const appCount = result?.count ?? 0
      const errors: { key: string; message: string }[] = []

      if (appCount !== this.preparedRows.length) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${this.preparedRows.length} miniApps but found ${appCount}`
        })
      }

      // All rows must have non-empty appId, name, and url.
      const badRows = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(miniAppTable)
        .where(sql`${miniAppTable.appId} = '' OR ${miniAppTable.name} = '' OR ${miniAppTable.url} = ''`)
        .get()
      const badCount = badRows?.count ?? 0
      if (badCount > 0) {
        errors.push({
          key: 'empty_fields',
          message: `Found ${badCount} rows with empty appId, name, or url`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.originalSourceCount,
          targetCount: appCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.originalSourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}

interface LoadCustomMiniAppsResult {
  apps: LegacyCustomMiniApp[]
  isAuthoritativeSnapshot: boolean
  invalidCount: number
  warnings: string[]
}

/**
 * Load the v1 `custom-minapps.json` sidecar at the path supplied by
 * MigrationPaths and return complete custom-app records. Tolerant of missing
 * files and malformed array entries. When the whole file is unreadable,
 * unparseable, or the wrong shape, it is quarantined to
 * `${file}.broken-<ts>.bak` so subsequent runs don't keep tripping on it, and
 * a user-visible warning is surfaced through the returned `warnings`.
 */
async function loadCustomMiniApps(file: string | undefined): Promise<LoadCustomMiniAppsResult> {
  const apps: LegacyCustomMiniApp[] = []
  let invalidCount = 0
  const warnings: string[] = []
  if (!file) return { apps, isAuthoritativeSnapshot: false, invalidCount, warnings }

  const quarantine = async (reason: string) => {
    const backup = `${file}.broken-${Date.now()}.bak`
    try {
      await fs.rename(file, backup)
      const msg = `Quarantined unreadable custom-minapps.json (${reason}) to ${backup}; custom apps cannot be migrated`
      warnings.push(msg)
      logger.warn(msg)
    } catch (renameErr) {
      // If we can't even rename, just warn — leaving the file in place is
      // safer than silently swallowing the failure.
      warnings.push(`Failed to load and quarantine custom-minapps.json (${reason})`)
      logger.warn('Failed to quarantine custom-minapps.json', renameErr as Error)
    }
  }

  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { apps, isAuthoritativeSnapshot: false, invalidCount, warnings }
    }
    logger.warn('Failed to read custom-minapps.json', err instanceof Error ? err : new Error(String(err)))
    await quarantine(`read failed: ${(err as Error).message ?? String(err)}`)
    return { apps, isAuthoritativeSnapshot: false, invalidCount, warnings }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    logger.warn('Failed to parse custom-minapps.json', err instanceof Error ? err : new Error(String(err)))
    await quarantine('invalid JSON')
    return { apps, isAuthoritativeSnapshot: false, invalidCount, warnings }
  }
  if (!Array.isArray(parsed)) {
    logger.warn('custom-minapps.json is not a JSON array, ignoring')
    await quarantine('top-level value is not an array')
    return { apps, isAuthoritativeSnapshot: false, invalidCount, warnings }
  }

  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      invalidCount++
      warnings.push(`Skipped custom app at index ${index}: expected an object`)
      continue
    }

    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) {
      invalidCount++
      warnings.push(`Skipped custom app at index ${index}: missing valid id`)
      continue
    }

    const logo = typeof record.logo === 'string' && record.logo.length > 0 ? record.logo : 'application'
    apps.push({ ...record, id: record.id, logo, type: 'Custom' })
  }

  return { apps, isAuthoritativeSnapshot: invalidCount === 0, invalidCount, warnings }
}
