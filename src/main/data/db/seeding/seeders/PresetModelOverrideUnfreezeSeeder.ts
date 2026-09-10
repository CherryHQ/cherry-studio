import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import {
  ensureOperationCapability,
  matchesModelPricingBaseline,
  mergePresetModel
} from '@data/services/ProviderRegistryService'
import { resolveRegistryPaths } from '@data/services/utils/registryDataPaths'
import type { Model } from '@shared/data/types/model'
import { eq, isNotNull } from 'drizzle-orm'
import { isEqual } from 'es-toolkit/compat'

import type { DbType, ISeeder } from '../../types'

const sameSet = (a: readonly unknown[], b: readonly unknown[] | undefined) =>
  b !== undefined && a.length === b.length && a.every((item) => b.includes(item))

type UnfreezableColumn =
  | 'capabilities'
  | 'inputModalities'
  | 'outputModalities'
  | 'endpointTypes'
  | 'name'
  | 'description'
  | 'contextWindow'
  | 'maxInputTokens'
  | 'maxOutputTokens'
  | 'supportsStreaming'
  | 'pricing'
  | 'parameters'

/** Delta columns and the test that says "this stored value is just the registry's own value". */
const REGISTRY_EQUAL: ReadonlyArray<[UnfreezableColumn, (stored: never, baseline: Model) => boolean]> = [
  [
    'capabilities',
    (v: Model['capabilities'], b) =>
      sameSet(ensureOperationCapability({ ...b, capabilities: v }, b).capabilities, b.capabilities)
  ],
  ['inputModalities', (v: NonNullable<Model['inputModalities']>, b) => sameSet(v, b.inputModalities)],
  ['outputModalities', (v: NonNullable<Model['outputModalities']>, b) => sameSet(v, b.outputModalities)],
  ['endpointTypes', (v: NonNullable<Model['endpointTypes']>, b) => sameSet(v, b.endpointTypes)],
  ['name', (v: string, b) => v === b.name],
  ['description', (v: string, b) => v === b.description],
  ['contextWindow', (v: number, b) => v === b.contextWindow],
  ['maxInputTokens', (v: number, b) => v === b.maxInputTokens],
  ['maxOutputTokens', (v: number, b) => v === b.maxOutputTokens],
  ['supportsStreaming', (v: boolean, b) => v === b.supportsStreaming],
  ['pricing', (v: Model['pricing'], b) => matchesModelPricingBaseline(v, b.pricing)],
  ['parameters', (v: Model['parameterSupport'], b) => isEqual(v, b.parameterSupport)]
]

/**
 * One pass over rows written before overrides were stored verbatim. The old write path
 * compared patches with the registry and froze anything that did not match exactly, so a
 * reordered list or an echoed default sits in the row as a snapshot, not a choice. A delta
 * equal to today's registry value changes nothing now and only blocks future registry
 * updates, so it is handed back.
 */
export class PresetModelOverrideUnfreezeSeeder implements ISeeder {
  readonly name = 'presetModelOverrideUnfreeze'
  readonly description = 'Hand registry-equal preset model deltas back to the registry'
  readonly version = '2026-09-08'

  run(db: DbType): void {
    const loader = new RegistryLoader(resolveRegistryPaths())
    const rows = db
      .select({ row: userModelTable, presetProviderId: userProviderTable.presetProviderId })
      .from(userModelTable)
      .innerJoin(userProviderTable, eq(userModelTable.providerId, userProviderTable.providerId))
      .where(isNotNull(userModelTable.presetModelId))
      .all()

    const baselines = rows.map(({ row, presetProviderId }) => {
      const presetProvider =
        loader.findProvider(row.providerId) ?? (presetProviderId ? loader.findProvider(presetProviderId) : null)
      const override = presetProvider ? loader.findOverride(presetProvider.id, row.modelId) : null
      const presetModel = loader.findModel(override?.modelId ?? row.modelId)
      return { row, baseline: presetModel ? mergePresetModel(presetModel, override, row.providerId) : null }
    })

    db.transaction(() => {
      for (const { row, baseline } of baselines) {
        if (!baseline) continue
        const updates: Partial<Record<UnfreezableColumn, null>> = {}
        for (const [column, equalsBaseline] of REGISTRY_EQUAL) {
          const stored = row[column]
          if (stored !== null && equalsBaseline(stored as never, baseline)) updates[column] = null
        }
        if (Object.keys(updates).length === 0) continue
        db.update(userModelTable).set(updates).where(eq(userModelTable.id, row.id)).run()
      }
    })
  }
}
