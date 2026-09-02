/**
 * MiniApp Service - handles miniapp CRUD operations.
 *
 * Owns the `mini_app` SQLite table. Mirrors {@link ProviderService}:
 * uniform CRUD over rows, with row-shape policy enforced via column checks
 * (`presetMiniAppId`). Preset display fields are seeded by {@link MiniAppSeeder}
 * at boot and refreshed on every re-run (no UI exposes them for editing).
 *
 * Layered preset pattern:
 *   - presetMiniAppId !== null  →  inherits from a {@link PRESETS_MINI_APPS} entry
 *   - presetMiniAppId === null  →  pure custom app
 */

import { application } from '@application'
import { miniAppLogoFileRefTable } from '@data/db/schemas/fileRelations'
import {
  type InsertMiniAppRow,
  miniAppInstallationTable,
  type MiniAppRow,
  type MiniAppStatus,
  miniAppTable
} from '@data/db/schemas/miniApp'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, MiniAppStatusBatch, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { PRESETS_MINI_APPS } from '@shared/data/presets/miniApps'
import type { MiniApp, MiniAppId, SiteMiniApp } from '@shared/data/types/miniApp'
import { type MiniAppManifest, MiniAppManifestSchema, resolveLocalizedText } from '@shared/types/miniAppManifest'
import { and, asc, desc, eq, getTableColumns, gt, inArray, lt, ne } from 'drizzle-orm'

import { applyMoves, generateOrderKeyBetween, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'
import {
  clearSingleFileRefTx,
  getSingleFileRefId,
  type LogoBindInput,
  reconcileLogoSlotTx
} from './utils/singleFileRef'

const logger = loggerService.withContext('DataApi:MiniAppService')

/**
 * Internal update input. `logo` is NOT part of the PATCH DTO (logo edits go
 * through the `mini_app.settings.set_logo` IpcApi command); the command orchestrator
 * passes a `LogoBindInput` here after creating the `file_entry`.
 */
export type UpdateMiniAppInput = UpdateMiniAppDto & { logo?: LogoBindInput }

/** Preset id set, used for write-time collision rejection. */
const presetMiniAppIdSet: ReadonlySet<string> = new Set(PRESETS_MINI_APPS.map((p) => p.id))
const customMutableFields = ['name', 'url', 'logo'] as const
// A local app's identity IS its package: `url` edits escape the sandbox, `logo` is its face in
// notifications. Only `status`/`orderKey` stay editable; the packaged icon goes via setInstalledLogo().
const IDENTITY_FIELDS = ['url', 'name', 'logo'] as const
const visibleStatusValues = ['enabled', 'pinned'] satisfies MiniAppStatus[]
const visibleStatuses: ReadonlySet<MiniAppStatus> = new Set(visibleStatusValues)

function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

function hasOwnDefined<T extends object>(object: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined
}

function isVisibleStatus(status: MiniAppStatus): boolean {
  return visibleStatuses.has(status)
}

function orderScopeForStatus(status: MiniAppStatus) {
  return isVisibleStatus(status) ? inArray(miniAppTable.status, visibleStatusValues) : eq(miniAppTable.status, status)
}

function statusOrderKeyForTransition(
  tx: DbOrTx,
  appId: string,
  existing: { status: MiniAppStatus; orderKey: string },
  targetStatus: MiniAppStatus
): string {
  if (isVisibleStatus(existing.status) && isVisibleStatus(targetStatus)) {
    const visibleScope = and(orderScopeForStatus(targetStatus), ne(miniAppTable.appId, appId))
    const [before] = tx
      .select({ orderKey: miniAppTable.orderKey })
      .from(miniAppTable)
      .where(and(visibleScope, lt(miniAppTable.orderKey, existing.orderKey)))
      .orderBy(desc(miniAppTable.orderKey))
      .limit(1)
      .all()
    const [same] = tx
      .select({ orderKey: miniAppTable.orderKey })
      .from(miniAppTable)
      .where(and(visibleScope, eq(miniAppTable.orderKey, existing.orderKey)))
      .limit(1)
      .all()
    const [after] = tx
      .select({ orderKey: miniAppTable.orderKey })
      .from(miniAppTable)
      .where(and(visibleScope, gt(miniAppTable.orderKey, existing.orderKey)))
      .orderBy(asc(miniAppTable.orderKey))
      .limit(1)
      .all()

    if (same) {
      return existing.status === 'enabled'
        ? generateOrderKeyBetween(before?.orderKey ?? null, same.orderKey)
        : generateOrderKeyBetween(same.orderKey, after?.orderKey ?? null)
    }
    if (before || after) {
      return generateOrderKeyBetween(before?.orderKey ?? null, after?.orderKey ?? null)
    }
    return existing.orderKey
  }

  const [tail] = tx
    .select({ orderKey: miniAppTable.orderKey })
    .from(miniAppTable)
    .where(and(orderScopeForStatus(targetStatus), ne(miniAppTable.appId, appId)))
    .orderBy(desc(miniAppTable.orderKey))
    .limit(1)
    .all()
  return generateOrderKeyBetween(tail?.orderKey ?? null, null)
}

// The projection is EXPLICIT: a bare `select().leftJoin()` returns a table-NESTED
// shape, not the flat row the mapper reads. Site rows join to nothing → both null.
const joinedMiniApp = () =>
  application
    .get('DbService')
    .getDb()
    .select({
      ...getTableColumns(miniAppTable),
      version: miniAppInstallationTable.version,
      manifestJson: miniAppInstallationTable.manifestJson,
      aiModelId: miniAppInstallationTable.aiModelId,
      aiQuickModelId: miniAppInstallationTable.aiQuickModelId
    })
    .from(miniAppTable)
    .leftJoin(miniAppInstallationTable, eq(miniAppInstallationTable.appId, miniAppTable.appId))

/** The columns the LEFT JOIN adds. Null on a site row, which joins to nothing. */
type InstallationExtras = {
  version: string | null
  manifestJson: MiniAppManifest | null
  aiModelId: string | null
  aiQuickModelId: string | null
}

/** Convert a DB row to the public MiniApp DTO. */
function rowToMiniApp(row: MiniAppRow & InstallationExtras): MiniApp {
  const clean = nullsToUndefined(row)
  const presetMiniAppId = clean.presetMiniAppId ?? null
  // An uploaded logo's file id lives in the ref table (single source of truth);
  // resolve it main-side so the renderer never reconstructs a disk path. Empty
  // slot → no lookup. A present id is never dangling (the ref row's
  // `file_entry_id` FK is `on delete cascade`), so letting `getUrl` throw
  // surfaces a real invariant break instead of swallowing it.
  const logoFileId = getSingleFileRefId(miniAppLogoFileRefTable, clean.appId)
  const base = {
    appId: brandId(clean.appId),
    name: clean.name,
    url: clean.url,
    // Preset icon key stays on `logo`, an uploaded one on `logoSrc` — mutually exclusive.
    logo: clean.logoKey,
    logoSrc: logoFileId ? application.get('FileManager').getUrl(logoFileId) : undefined,
    status: clean.status,
    orderKey: clean.orderKey,
    createdAt: timestampToISO(clean.createdAt),
    updatedAt: timestampToISO(clean.updatedAt)
  }

  if (row.kind === 'app') {
    // Not a case to handle: the installation row is what MAKES an app an app, and
    // both are written in one transaction — a null here is a broken invariant.
    const manifest = MiniAppManifestSchema.parse(row.manifestJson)
    return {
      ...base,
      kind: 'app',
      // From the ROW. Hardcoding null here silently demotes every builtin app on the
      // next query — the badge, the region rule and the edit guard all read this (design §3.1).
      presetMiniAppId: row.presetMiniAppId,
      version: row.version!,
      // The stored `name` column keeps the stable 'en' form; the DISPLAYED name is
      // resolved per UI language from the manifest, so a language switch needs no row rewrite.
      name: resolveLocalizedText(manifest.name, getAppLanguage()),
      nameI18n: manifest.name,
      aiModelId: row.aiModelId,
      aiQuickModelId: row.aiQuickModelId
    }
  }

  const app: SiteMiniApp = { ...base, kind: 'site', presetMiniAppId }
  if (presetMiniAppId !== null) {
    app.bordered = clean.bordered
    app.background = clean.background
    app.supportedRegions = clean.supportedRegions
    app.configuration = clean.configuration
    app.nameKey = clean.nameKey
  }
  return app
}

export class MiniAppService {
  /** Get a miniapp by appId. Throws NOT_FOUND if absent. */
  getByAppId(appId: string): MiniApp {
    const [row] = joinedMiniApp().where(eq(miniAppTable.appId, appId)).limit(1).all()
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    return rowToMiniApp(row)
  }

  /**
   * List miniApps with optional filters.
   * Sort: status priority (pinned > enabled > disabled), then orderKey ASC.
   */
  list(query: { status?: MiniAppStatus } = {}): MiniApp[] {
    const where = query.status !== undefined ? eq(miniAppTable.status, query.status) : undefined
    const rows = joinedMiniApp().where(where).orderBy(asc(miniAppTable.orderKey)).all()

    const items = rows.map(rowToMiniApp)
    items.sort((a, b) => {
      const order = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const diff = order(a.status) - order(b.status)
      if (diff !== 0) return diff
      return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
    })
    return items
  }

  /**
   * Create a custom miniapp. Rejects collisions with preset ids.
   * Auto-assigns orderKey at the end of the visible miniapp list.
   */
  create(dto: CreateMiniAppDto): MiniApp {
    if (presetMiniAppIdSet.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a preset app and cannot be recreated`)
    }

    const status: MiniAppStatus = 'enabled'
    const row = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const logoCols = reconcileLogoSlotTx(tx, miniAppLogoFileRefTable, dto.appId, dto.logo) ?? {
            logoKey: null
          }
          const inserted = insertWithOrderKey(
            tx,
            miniAppTable,
            {
              appId: dto.appId,
              presetMiniAppId: null,
              name: dto.name,
              url: dto.url,
              logoKey: logoCols.logoKey,
              status
            },
            {
              pkColumn: miniAppTable.appId,
              position: 'last',
              scope: orderScopeForStatus(status)
            }
          )
          return inserted as MiniAppRow | undefined
        }),
      defaultHandlersFor('MiniApp', dto.appId)
    )
    if (!row) {
      throw DataApiErrorFactory.internal(new Error('Insert returned no rows'), 'MiniApp.create')
    }
    logger.info('Created custom miniapp', { appId: row.appId, orderKey: row.orderKey })
    // Only site rows are created here (the custom-site form is the sole entry), so
    // there is no installation row to join — say so explicitly.
    return rowToMiniApp({ ...row, version: null, manifestJson: null, aiModelId: null, aiQuickModelId: null })
  }

  /**
   * Update an existing miniapp. Preset rows only accept `status` changes because
   * their display fields are refreshed by {@link MiniAppSeeder}. Custom rows can
   * also edit the user-facing fields exposed by the custom miniapp form.
   *
   * On status transitions the row receives an `orderKey` in the target list.
   * `enabled` and `pinned` share the visible MiniApp list, so transitions
   * between them keep the same relative position among visible rows, generating
   * a fresh key between the same neighbors when needed. Moving into visible
   * status lands at the visible tail; moving into `disabled` lands at the
   * disabled tail. When `order` is provided, the status and target placement
   * commit in the same transaction.
   */
  update(appId: string, dto: UpdateMiniAppInput): MiniApp {
    const hasStatusUpdate = dto.status !== undefined
    const hasCustomUpdate = customMutableFields.some((field) => hasOwnDefined(dto, field))
    const modelUpdates = {
      ...(dto.aiModelId !== undefined ? { aiModelId: dto.aiModelId } : {}),
      ...(dto.aiQuickModelId !== undefined ? { aiQuickModelId: dto.aiQuickModelId } : {})
    }
    const hasAiModelUpdate = Object.keys(modelUpdates).length > 0

    if (dto.order !== undefined && !hasStatusUpdate) {
      throw DataApiErrorFactory.validation({ order: ['order requires status'] }, 'Order requires a status update')
    }

    if (!hasStatusUpdate && !hasCustomUpdate && !hasAiModelUpdate) {
      throw DataApiErrorFactory.validation(
        { _root: [`No updatable fields provided for "${appId}"`] },
        'No applicable fields to update'
      )
    }

    const row = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [existing] = tx
            .select({
              kind: miniAppTable.kind,
              presetMiniAppId: miniAppTable.presetMiniAppId,
              status: miniAppTable.status,
              orderKey: miniAppTable.orderKey
            })
            .from(miniAppTable)
            .where(eq(miniAppTable.appId, appId))
            .limit(1)
            .all()
          if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

          if (existing.kind === 'app' && IDENTITY_FIELDS.some((k) => dto[k] !== undefined)) {
            throw DataApiErrorFactory.invalidOperation(
              `update miniapp ${appId}`,
              'installed mini apps are described by their package; use the detail panel to update or uninstall'
            )
          }

          if (hasCustomUpdate && existing.presetMiniAppId !== null) {
            throw DataApiErrorFactory.invalidOperation(
              `update miniapp ${appId}`,
              'preset-derived miniapp user-facing fields cannot be edited'
            )
          }

          // The model choices live on the installation row, which only an installed app has.
          if (hasAiModelUpdate) {
            if (existing.kind !== 'app') {
              throw DataApiErrorFactory.invalidOperation(
                `update miniapp ${appId}`,
                'only installed mini apps have a model setting'
              )
            }
            tx.update(miniAppInstallationTable).set(modelUpdates).where(eq(miniAppInstallationTable.appId, appId)).run()
          }

          const updates: Partial<InsertMiniAppRow> = {}

          if (dto.name !== undefined) updates.name = dto.name
          if (dto.url !== undefined) updates.url = dto.url
          // DB-only logo reconcile: replace the slot's file_ref + set the logo key.
          const logoCols = reconcileLogoSlotTx(tx, miniAppLogoFileRefTable, appId, dto.logo)
          if (logoCols) {
            updates.logoKey = logoCols.logoKey
          }

          if (hasStatusUpdate) {
            const targetStatus = dto.status as MiniAppStatus
            updates.status = targetStatus
            if (existing.status !== targetStatus && dto.order === undefined) {
              updates.orderKey = statusOrderKeyForTransition(tx, appId, existing, targetStatus)
            }
          }

          // A model-only PATCH touched the installation row alone; an empty SET is a Drizzle error.
          if (Object.keys(updates).length === 0) return existing
          const [updated] = tx.update(miniAppTable).set(updates).where(eq(miniAppTable.appId, appId)).returning().all()
          if (dto.order === undefined || dto.status === undefined) return updated

          applyMoves(tx, miniAppTable, [{ id: appId, anchor: dto.order }], {
            pkColumn: miniAppTable.appId,
            scope: orderScopeForStatus(dto.status)
          })
          const [ordered] = tx.select().from(miniAppTable).where(eq(miniAppTable.appId, appId)).limit(1).all()
          return ordered
        }),
      defaultHandlersFor('MiniApp', appId)
    )
    if (!row) throw DataApiErrorFactory.notFound('MiniApp', appId)
    logger.info('Updated miniapp', { appId, changes: Object.keys(dto) })
    // Re-read through the join: the written row alone would yield a LocalMiniApp
    // with no version. A row becomes a MiniApp by exactly one path.
    return this.getByAppId(appId)
  }

  updateStatusBatch(updates: MiniAppStatusBatch['updates']): void {
    if (updates.length === 0) return

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const visibleMoves: Array<{ id: string; anchor: OrderRequest }> = []
          const disabledMoves: Array<{ id: string; anchor: OrderRequest }> = []

          for (const update of updates) {
            const [existing] = tx
              .select({ status: miniAppTable.status, orderKey: miniAppTable.orderKey })
              .from(miniAppTable)
              .where(eq(miniAppTable.appId, update.appId))
              .limit(1)
              .all()
            if (!existing) throw DataApiErrorFactory.notFound('MiniApp', update.appId)
            const orderKey =
              existing.status !== update.status && update.order === undefined
                ? statusOrderKeyForTransition(tx, update.appId, existing, update.status)
                : existing.orderKey
            tx.update(miniAppTable)
              .set({ status: update.status, orderKey })
              .where(eq(miniAppTable.appId, update.appId))
              .run()

            if (update.order !== undefined) {
              const move = { id: update.appId, anchor: update.order }
              if (isVisibleStatus(update.status)) visibleMoves.push(move)
              else disabledMoves.push(move)
            }
          }

          if (visibleMoves.length > 0) {
            applyMoves(tx, miniAppTable, visibleMoves, {
              pkColumn: miniAppTable.appId,
              scope: orderScopeForStatus('enabled')
            })
          }
          if (disabledMoves.length > 0) {
            applyMoves(tx, miniAppTable, disabledMoves, {
              pkColumn: miniAppTable.appId,
              scope: orderScopeForStatus('disabled')
            })
          }
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )
    logger.info('Updated miniapp statuses', { count: updates.length })
  }

  /**
   * Bind a packaged icon to an installed (`kind='app'`) row. The installer's own
   * entry: `update()` rejects `logo` on app rows because it backs the
   * user-reachable `mini_app.settings.set_logo` command, whereas the packaged icon is
   * written only by install / update / rollback code.
   */
  setInstalledLogo(appId: string, logo: LogoBindInput): void {
    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [existing] = tx
            .select({ kind: miniAppTable.kind })
            .from(miniAppTable)
            .where(eq(miniAppTable.appId, appId))
            .limit(1)
            .all()
          if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

          if (existing.kind !== 'app') {
            throw DataApiErrorFactory.invalidOperation(
              `set installed logo ${appId}`,
              'only installed mini apps carry a packaged icon; site logos go through update()'
            )
          }

          const logoCols = reconcileLogoSlotTx(tx, miniAppLogoFileRefTable, appId, logo)!
          tx.update(miniAppTable).set({ logoKey: logoCols.logoKey }).where(eq(miniAppTable.appId, appId)).run()
        }),
      defaultHandlersFor('MiniApp', appId)
    )
    logger.info('Bound packaged icon', { appId, kind: logo.kind })
  }

  /**
   * Delete a miniapp. Preset-derived rows cannot be deleted (use status='disabled').
   * Mirrors {@link ProviderService.delete}'s preset guard.
   */
  delete(appId: string): void {
    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [existing] = tx
            .select({ kind: miniAppTable.kind, presetMiniAppId: miniAppTable.presetMiniAppId })
            .from(miniAppTable)
            .where(eq(miniAppTable.appId, appId))
            .limit(1)
            .all()
          if (!existing) throw DataApiErrorFactory.notFound('MiniApp', appId)

          // Must go through `uninstallMiniApp`, which is journalled and removes the files.
          // Deleting the row here leaves the package on disk with nothing pointing at it.
          if (existing.kind === 'app') {
            throw DataApiErrorFactory.invalidOperation(
              `delete miniapp ${appId}`,
              'installed mini apps must be uninstalled through mini_app.uninstall'
            )
          }

          if (existing.presetMiniAppId !== null) {
            throw DataApiErrorFactory.invalidOperation(
              `delete miniapp ${appId}`,
              'preset-derived miniapp cannot be deleted; use PATCH with status="disabled" to hide'
            )
          }

          // DB-only: drop the logo slot's ref (the file is preserved per the
          // file layer's policy), then delete the row. The FK cascade would also
          // clear it on row delete; the explicit clear keeps the intent local.
          clearSingleFileRefTx(tx, miniAppLogoFileRefTable, appId)
          tx.delete(miniAppTable).where(eq(miniAppTable.appId, appId)).run()
        }),
      defaultHandlersFor('MiniApp', appId)
    )
    logger.info('Deleted miniapp', { appId })
  }

  /**
   * Reorder miniApps via fractional-indexing. Visible rows (`enabled` +
   * `pinned`) share one list; hidden rows (`disabled`) remain separate.
   * Cross visible/hidden batches are rejected — moving a row between visible
   * and hidden still goes through single-row PATCH, not PATCH /order:batch.
   */
  reorder(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return

    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const ids = moves.map((move) => move.id)
          const rows = tx
            .select({ appId: miniAppTable.appId, status: miniAppTable.status })
            .from(miniAppTable)
            .where(inArray(miniAppTable.appId, ids))
            .all()

          if (rows.length === 0) {
            throw DataApiErrorFactory.notFound('MiniApp', ids[0])
          }

          const hasVisible = rows.some((row) => isVisibleStatus(row.status))
          const hasHidden = rows.some((row) => !isVisibleStatus(row.status))
          if (hasVisible && hasHidden) {
            const message = 'MiniApp reorder batch cannot span visible and hidden lists'
            throw DataApiErrorFactory.validation({ _root: [message] }, message)
          }

          applyMoves(tx, miniAppTable, moves, {
            pkColumn: miniAppTable.appId,
            scope: hasVisible ? orderScopeForStatus('enabled') : eq(miniAppTable.status, 'disabled')
          })
        }),
      defaultHandlersFor('MiniApp', 'multiple')
    )
    logger.info('Reordered miniApps', { count: moves.length })
  }
}

export const miniAppService = new MiniAppService()
