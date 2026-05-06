/**
 * MiniApp Registry Service — bridges {@link PRESETS_MINI_APPS} (read-only TS preset data)
 * with user data persisted by {@link MiniAppService}.
 *
 * Per docs/references/data/best-practice-layered-preset-pattern.md §"Large-Scale Scenario":
 * "The Registry Service reads preset data from a package or shared constants,
 *  obtains user overrides from the owning Entity Service, and returns merged
 *  results. It does not access the database directly."
 *
 * Modeled after {@link ProviderRegistryService}. Owns all preset-vs-custom
 * policy decisions; the Entity Service performs uniform row-level CRUD.
 *
 *   appId ∈ PRESETS_MINI_APPS  →  preset (defaults) + DB override (delta)  =  merged "default" MiniApp
 *   appId ∉ PRESETS_MINI_APPS  →  DB row (full custom data)                =  "custom" MiniApp
 */

import type { MiniAppInsert, MiniAppSelect, MiniAppStatus } from '@data/db/schemas/miniapp'
import { loggerService } from '@logger'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateMiniAppDto, UpdateMiniAppDto } from '@shared/data/api/schemas/miniApps'
import { type MiniAppPreset, PRESETS_MINI_APPS } from '@shared/data/presets/mini-apps'
import type { MiniApp, MiniAppId } from '@shared/data/types/miniApp'

import { miniAppService } from './MiniAppService'
import { generateOrderKeySequence } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:MiniAppRegistryService')

const presetMap: ReadonlyMap<string, MiniAppPreset> = new Map(PRESETS_MINI_APPS.map((p) => [p.id, p]))

/**
 * Pre-generated fractional-indexing keys for preset apps in their declared order.
 * Used to seed an override row for a preset app that has no DB row yet.
 */
const PRESET_DEFAULT_ORDER_KEYS: ReadonlyArray<string> = generateOrderKeySequence(PRESETS_MINI_APPS.length)
const presetDefaultOrderKey: ReadonlyMap<string, string> = new Map(
  PRESETS_MINI_APPS.map((p, i) => [p.id, PRESET_DEFAULT_ORDER_KEYS[i]])
)

function brandId(raw: string): MiniAppId {
  return raw as MiniAppId
}

function timestampToISO(t: number): string {
  return new Date(t).toISOString()
}

function timestampToISOOrUndefined(t: number | null | undefined): string | undefined {
  return t == null ? undefined : timestampToISO(t)
}

/** Merge a preset with an optional DB override row → public MiniApp DTO. */
function mergePreset(preset: MiniAppPreset, override?: MiniAppSelect): MiniApp {
  return {
    appId: brandId(preset.id),
    kind: 'default',
    name: preset.name,
    url: preset.url,
    logo: preset.logo,
    bordered: preset.bordered,
    background: preset.background,
    supportedRegions: preset.supportedRegions,
    nameKey: preset.nameKey,
    configuration: undefined,
    status: override?.status ?? 'enabled',
    orderKey: override?.orderKey ?? presetDefaultOrderKey.get(preset.id) ?? '',
    createdAt: timestampToISOOrUndefined(override?.createdAt),
    updatedAt: timestampToISOOrUndefined(override?.updatedAt)
  }
}

/** Project a custom DB row → public MiniApp DTO. */
function customRowToMiniApp(row: MiniAppSelect): MiniApp {
  if (row.name === null || row.url === null) {
    throw DataApiErrorFactory.dataInconsistent(
      'MiniApp',
      `row "${row.appId}" has NULL name or url but presetMiniappId is null`
    )
  }
  return {
    appId: brandId(row.appId),
    kind: 'custom',
    name: row.name,
    url: row.url,
    logo: row.logo ?? undefined,
    bordered: row.bordered ?? undefined,
    background: row.background ?? undefined,
    supportedRegions: row.supportedRegions ?? undefined,
    configuration: row.configuration ?? undefined,
    nameKey: row.nameKey ?? undefined,
    status: row.status,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Build the row shape for a preset override (delta only). */
function buildOverrideRow(appId: string, status: MiniAppStatus, orderKey: string): MiniAppInsert {
  return {
    appId,
    presetMiniappId: appId,
    status,
    orderKey
  }
}

class MiniAppRegistryService {
  async getByAppId(appId: string): Promise<MiniApp> {
    const preset = presetMap.get(appId)
    if (preset) {
      const override = await miniAppService.findByAppId(appId)
      return mergePreset(preset, override)
    }
    const row = await miniAppService.getByAppId(appId)
    return customRowToMiniApp(row)
  }

  async list(query: { status?: MiniAppStatus; kind?: 'default' | 'custom' }): Promise<MiniApp[]> {
    const sortByStatusThenOrderKey = (a: MiniApp, b: MiniApp) => {
      const order = (s: MiniAppStatus) => (s === 'pinned' ? 0 : s === 'enabled' ? 1 : 2)
      const diff = order(a.status) - order(b.status)
      if (diff !== 0) return diff
      return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0
    }

    const items: MiniApp[] = []

    if (query.kind !== 'custom') {
      const overrideRows = await miniAppService.list({ hasPreset: true })
      const overrideByAppId = new Map(overrideRows.map((r) => [r.appId, r]))
      for (const preset of PRESETS_MINI_APPS) {
        const merged = mergePreset(preset, overrideByAppId.get(preset.id))
        if (query.status !== undefined && merged.status !== query.status) continue
        items.push(merged)
      }
    }

    if (query.kind !== 'default') {
      const customRows = await miniAppService.list({ hasPreset: false, status: query.status })
      for (const row of customRows) items.push(customRowToMiniApp(row))
    }

    return items.sort(sortByStatusThenOrderKey)
  }

  /** POST /mini-apps. Custom apps only — preset appIds are rejected. */
  async createCustom(dto: CreateMiniAppDto): Promise<MiniApp> {
    if (presetMap.has(dto.appId)) {
      throw DataApiErrorFactory.conflict(`MiniApp with appId "${dto.appId}" is a preset app and cannot be recreated`)
    }
    const row = await miniAppService.create({
      appId: dto.appId,
      presetMiniappId: null,
      name: dto.name,
      url: dto.url,
      logo: dto.logo,
      bordered: dto.bordered,
      background: dto.background ?? null,
      supportedRegions: dto.supportedRegions,
      configuration: dto.configuration,
      status: 'enabled'
    })
    return customRowToMiniApp(row)
  }

  /**
   * PATCH /mini-apps/:appId.
   * - Preset app: only `status` is mutable. Seeds an override row on first write.
   * - Custom app: all fields mutable.
   */
  async update(appId: string, dto: UpdateMiniAppDto): Promise<MiniApp> {
    const preset = presetMap.get(appId)
    if (preset) {
      const disallowed = (
        ['name', 'url', 'logo', 'bordered', 'background', 'supportedRegions', 'configuration'] as const
      ).filter((k) => dto[k] !== undefined)
      if (disallowed.length > 0) {
        throw DataApiErrorFactory.validation(
          { _root: [`Preset miniapp "${appId}" only accepts status updates; rejected: ${disallowed.join(', ')}`] },
          'Cannot modify preset fields on default miniapp'
        )
      }
      if (dto.status === undefined) {
        throw DataApiErrorFactory.validation(
          { _root: [`No updatable fields provided for preset miniapp "${appId}"`] },
          'No applicable fields to update'
        )
      }

      const existing = await miniAppService.findByAppId(appId)
      const override = existing
        ? await miniAppService.update(appId, { status: dto.status })
        : await miniAppService.upsert(buildOverrideRow(appId, dto.status, presetDefaultOrderKey.get(appId) ?? ''))
      return mergePreset(preset, override)
    }

    // Custom app: all writable fields
    const updates: Partial<MiniAppInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name
    if (dto.url !== undefined) updates.url = dto.url
    if (dto.logo !== undefined) updates.logo = dto.logo
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.bordered !== undefined) updates.bordered = dto.bordered
    if (dto.background !== undefined) updates.background = dto.background
    if (dto.supportedRegions !== undefined) updates.supportedRegions = dto.supportedRegions
    if (dto.configuration !== undefined) updates.configuration = dto.configuration

    const row = await miniAppService.update(appId, updates)
    return customRowToMiniApp(row)
  }

  /** DELETE /mini-apps/:appId. Preset apps cannot be deleted. */
  async delete(appId: string): Promise<void> {
    if (presetMap.has(appId)) {
      throw DataApiErrorFactory.invalidOperation(
        `delete preset miniapp "${appId}"`,
        'preset apps cannot be deleted; use PATCH with status="disabled" to hide'
      )
    }
    await miniAppService.delete(appId)
  }

  /**
   * Reorder miniapps. For preset apps without a DB row yet, seed an override
   * row first so `applyMoves` has something to anchor on.
   */
  async reorder(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    for (const m of moves) {
      const preset = presetMap.get(m.id)
      if (!preset) continue
      try {
        await miniAppService.getByAppId(m.id)
      } catch (err) {
        if (isDataApiError(err) && err.code === ErrorCode.NOT_FOUND) {
          await miniAppService.upsert(buildOverrideRow(m.id, 'enabled', presetDefaultOrderKey.get(m.id) ?? ''))
        } else {
          throw err
        }
      }
    }

    const targetIds = moves.map((m) => m.id)
    const statusByAppId = await miniAppService.getStatusesByAppIds(targetIds)

    const movesByStatus = new Map<MiniAppStatus, Array<{ id: string; anchor: OrderRequest }>>()
    for (const m of moves) {
      const status = statusByAppId.get(m.id)
      if (!status) throw DataApiErrorFactory.notFound('MiniApp', m.id)
      const bucket = movesByStatus.get(status) ?? []
      bucket.push(m)
      movesByStatus.set(status, bucket)
    }

    for (const [status, scopedMoves] of movesByStatus) {
      await miniAppService.applyMovesScoped(scopedMoves, status)
    }
    logger.info('Reordered miniapps', { count: moves.length, partitions: movesByStatus.size })
  }
}

export const miniAppRegistryService = new MiniAppRegistryService()
