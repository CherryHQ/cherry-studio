import { application } from '@application'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import type { NewUserModel } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  type Model,
  MODEL_CAPABILITY,
  parseUniqueModelId
} from '@shared/data/types/model'
import { eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'

type NewUserModelInput = Omit<NewUserModel, 'orderKey'>

function isImageGenerationModel(model: Model): boolean {
  if (model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)) {
    return true
  }
  return (
    model.endpointTypes?.some(
      (endpointType) =>
        endpointType === ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION || endpointType === ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
    ) ?? false
  )
}

function getApiModelId(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

function toUniqueModelId(model: Model): string {
  return createUniqueModelId(model.providerId, getApiModelId(model))
}

function toDbRow(model: Model): NewUserModelInput {
  return {
    id: toUniqueModelId(model),
    providerId: model.providerId,
    modelId: getApiModelId(model),
    presetModelId: model.presetModelId ?? null,
    name: model.name,
    description: model.description ?? null,
    group: model.group ?? null,
    capabilities: model.capabilities,
    inputModalities: model.inputModalities ?? null,
    outputModalities: model.outputModalities ?? null,
    endpointTypes: model.endpointTypes ?? null,
    contextWindow: model.contextWindow ?? null,
    maxInputTokens: model.maxInputTokens ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
    supportsStreaming: model.supportsStreaming,
    reasoning: model.reasoning ?? null,
    parameters: model.parameterSupport ?? null,
    pricing: model.pricing ?? null,
    isEnabled: model.isEnabled,
    isHidden: model.isHidden,
    isDeprecated: false
  }
}

function groupRowsByProvider(rows: NewUserModelInput[]): Map<string, NewUserModelInput[]> {
  const grouped = new Map<string, NewUserModelInput[]>()
  for (const row of rows) {
    const providerRows = grouped.get(row.providerId) ?? []
    providerRows.push(row)
    grouped.set(row.providerId, providerRows)
  }
  return grouped
}

export class PresetImageModelSeeder implements ISeeder {
  readonly name = 'presetImageModel'
  readonly description = 'Insert registry-declared image generation models'

  private _loader?: RegistryLoader

  private getLoader(): RegistryLoader {
    if (!this._loader) {
      this._loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this._loader
  }

  get version(): string {
    const loader = this.getLoader()
    return `${loader.getModelsVersion()}:${loader.getProviderModelsVersion()}`
  }

  async run(db: DbType): Promise<void> {
    const [activeModels, disabledModels] = await Promise.all([
      providerRegistryService.listProviderRegistryModels(),
      providerRegistryService.listProviderRegistryModels({ disabled: true })
    ])
    const activeRows = activeModels.filter(isImageGenerationModel).map(toDbRow)
    const activeIds = new Set(activeRows.map((row) => row.id))
    const disabledIds = new Set(disabledModels.filter(isImageGenerationModel).map(toUniqueModelId))
    const registryIds = [...new Set([...activeIds, ...disabledIds])]

    await db.transaction(async (tx) => {
      const existingRows =
        registryIds.length > 0
          ? await tx
              .select({
                id: userModelTable.id,
                isDeprecated: userModelTable.isDeprecated
              })
              .from(userModelTable)
              .where(inArray(userModelTable.id, registryIds))
          : []

      const existingIds = new Set(existingRows.map((row) => row.id))
      const activeRowsToRestore = existingRows
        .filter((row) => activeIds.has(row.id) && row.isDeprecated)
        .map((row) => row.id)
      const disabledRowsToDeprecate = existingRows
        .filter((row) => disabledIds.has(row.id) && !row.isDeprecated)
        .map((row) => row.id)

      if (activeRowsToRestore.length > 0) {
        await tx
          .update(userModelTable)
          .set({ isDeprecated: false })
          .where(inArray(userModelTable.id, activeRowsToRestore))
      }

      if (disabledRowsToDeprecate.length > 0) {
        await tx
          .update(userModelTable)
          .set({ isDeprecated: true })
          .where(inArray(userModelTable.id, disabledRowsToDeprecate))
      }

      const rowsToInsert = activeRows.filter((row) => !existingIds.has(row.id))
      for (const [providerId, rows] of groupRowsByProvider(rowsToInsert)) {
        await insertManyWithOrderKey(tx, userModelTable, rows, {
          pkColumn: userModelTable.id,
          scope: eq(userModelTable.providerId, providerId)
        })
      }
    })
  }
}
