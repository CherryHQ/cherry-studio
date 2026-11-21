import fs from 'node:fs/promises'

import dayjs from 'dayjs'
import { eq } from 'drizzle-orm'
import { type BrowserWindow, dialog } from 'electron'

import { application } from '@application'
import { userModelTable, type UserModelRow } from '@data/db/schemas/userModel'
import { userProviderTable, type UserProviderRow } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { isManagedCherryProviderId } from '@shared/data/presets/cherryai'
import { createUniqueModelId } from '@shared/data/types/model'
import {
  MODEL_SETTINGS_FORMAT,
  MODEL_SETTINGS_MAX_FILE_BYTES,
  MODEL_SETTINGS_VERSION,
  type ModelSettingsConflict,
  type ModelSettingsDecision,
  type ModelSettingsDocument,
  ModelSettingsDocumentSchema,
  type ModelSettingsImportPreview,
  type ModelSettingsImportResult
} from '@shared/types/modelSettingsBackup'

const logger = loggerService.withContext('ModelSettingsBackupService')

type ExportedProvider = ModelSettingsDocument['providers'][number]
type ExportedModel = ModelSettingsDocument['models'][number]

const providerKey = (providerId: string) => `provider:${providerId}`
const modelKey = (uniqueModelId: string) => `model:${uniqueModelId}`

/** Drops `undefined` entries so a patch never writes a key the file did not carry. */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function withoutKeys<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toExportedProvider(row: UserProviderRow): ExportedProvider {
  return {
    providerId: row.providerId,
    presetProviderId: row.presetProviderId ?? undefined,
    name: row.name,
    endpointConfigs: row.endpointConfigs ?? undefined,
    defaultChatEndpoint: row.defaultChatEndpoint ?? undefined,
    apiKeys: row.apiKeys ?? undefined,
    authConfig: row.authConfig ?? undefined,
    providerSettings: row.providerSettings ?? undefined,
    isEnabled: row.isEnabled
  }
}

function toExportedModel(row: UserModelRow): ExportedModel {
  return {
    providerId: row.providerId,
    modelId: row.modelId,
    presetModelId: row.presetModelId ?? undefined,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    group: row.group ?? undefined,
    capabilities: row.capabilities ?? undefined,
    inputModalities: row.inputModalities ?? undefined,
    outputModalities: row.outputModalities ?? undefined,
    endpointTypes: row.endpointTypes ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    maxInputTokens: row.maxInputTokens ?? undefined,
    maxOutputTokens: row.maxOutputTokens ?? undefined,
    supportsStreaming: row.supportsStreaming ?? undefined,
    parameterSupport: row.parameters ?? undefined,
    pricing: row.pricing ?? undefined,
    isEnabled: row.isEnabled,
    isHidden: row.isHidden
  }
}

/** Registry-miss falls back to a custom model, mirroring the DataApi POST /models handler. */
function lookupRegistryForCreate(providerId: string, modelId: string) {
  try {
    return providerRegistryService.lookupModel(providerId, modelId)
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return undefined
    throw error
  }
}

class ModelSettingsBackupService {
  async exportToFile(senderId?: string | null): Promise<{ filePath: string | null }> {
    const parent = this.resolveParent(senderId)
    const options = {
      title: t('dialog.save_file'),
      defaultPath: `cherry-studio-models-${dayjs().format('YYYYMMDD')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return { filePath: null }

    const document = this.buildDocument()
    await fs.writeFile(filePath, JSON.stringify(document, null, 2), 'utf-8')
    logger.info('Exported model settings', { providers: document.providers.length, models: document.models.length })
    return { filePath }
  }

  async pickImportFile(senderId?: string | null): Promise<ModelSettingsImportPreview | null> {
    const parent = this.resolveParent(senderId)
    const options = {
      title: t('dialog.open_file'),
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return null

    const filePath = filePaths[0]
    const { size } = await fs.stat(filePath)
    if (size > MODEL_SETTINGS_MAX_FILE_BYTES) {
      throw new Error('model settings file exceeds the 10 MiB limit')
    }
    const parsed = ModelSettingsDocumentSchema.safeParse(JSON.parse(await fs.readFile(filePath, 'utf-8')))
    if (!parsed.success) {
      throw new Error(`invalid model settings file: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    }
    return { document: parsed.data, conflicts: this.findConflicts(parsed.data) }
  }

  /** Recomputes conflicts at apply time, so a decision never overrides a row that changed after preview. */
  applyImport(
    document: ModelSettingsDocument,
    decisions: Record<string, ModelSettingsDecision>
  ): ModelSettingsImportResult {
    const { existingProviderIds, existingModelIds } = this.loadExistingIds()
    const result: ModelSettingsImportResult = { created: 0, replaced: 0, skipped: 0, failed: [] }
    const failedProviderIds = new Set<string>()

    for (const provider of document.providers) {
      const exists = existingProviderIds.has(provider.providerId)
      if (exists && decisions[providerKey(provider.providerId)] !== 'replace') {
        result.skipped++
        continue
      }
      try {
        if (exists) {
          this.replaceProvider(provider)
          result.replaced++
        } else {
          this.createProvider(provider)
          result.created++
        }
      } catch (error) {
        failedProviderIds.add(provider.providerId)
        result.failed.push({ kind: 'provider', id: provider.providerId, reason: errorMessage(error) })
      }
    }

    for (const model of document.models) {
      const uniqueModelId = createUniqueModelId(model.providerId, model.modelId)
      if (failedProviderIds.has(model.providerId)) {
        result.failed.push({ kind: 'model', id: uniqueModelId, reason: 'provider_not_imported' })
        continue
      }
      const exists = existingModelIds.has(uniqueModelId)
      if (exists && decisions[modelKey(uniqueModelId)] !== 'replace') {
        result.skipped++
        continue
      }
      try {
        if (exists) {
          this.replaceModel(model)
          result.replaced++
        } else {
          this.createModel(model)
          result.created++
        }
      } catch (error) {
        result.failed.push({ kind: 'model', id: uniqueModelId, reason: errorMessage(error) })
      }
    }

    logger.info('Imported model settings', { ...result, failed: result.failed.length })
    return result
  }

  private resolveParent(senderId?: string | null): BrowserWindow | undefined {
    const candidate = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    return candidate && !candidate.isDestroyed() ? candidate : undefined
  }

  private buildDocument(): ModelSettingsDocument {
    const db = application.get('DbService').getDb()
    const providerRows = db
      .select()
      .from(userProviderTable)
      .all()
      .filter((row) => !isManagedCherryProviderId(row.providerId))
    const providerIds = new Set(providerRows.map((row) => row.providerId))
    const modelRows = db
      .select()
      .from(userModelTable)
      .all()
      .filter((row) => providerIds.has(row.providerId))

    return {
      format: MODEL_SETTINGS_FORMAT,
      version: MODEL_SETTINGS_VERSION,
      exportedAt: Date.now(),
      providers: providerRows.map(toExportedProvider),
      models: modelRows.map(toExportedModel)
    }
  }

  private loadExistingIds() {
    const db = application.get('DbService').getDb()
    return {
      existingProviderIds: new Set(
        db
          .select({ providerId: userProviderTable.providerId })
          .from(userProviderTable)
          .all()
          .map((row) => row.providerId)
      ),
      existingModelIds: new Set(
        db
          .select({ id: userModelTable.id })
          .from(userModelTable)
          .all()
          .map((row) => row.id)
      )
    }
  }

  private findConflicts(document: ModelSettingsDocument): ModelSettingsConflict[] {
    const { existingProviderIds, existingModelIds } = this.loadExistingIds()
    return [
      ...document.providers
        .filter((provider) => existingProviderIds.has(provider.providerId))
        .map((provider) => ({
          key: providerKey(provider.providerId),
          kind: 'provider' as const,
          label: provider.name
        })),
      ...document.models
        .map((model) => createUniqueModelId(model.providerId, model.modelId))
        .filter((uniqueModelId) => existingModelIds.has(uniqueModelId))
        .map((uniqueModelId) => ({ key: modelKey(uniqueModelId), kind: 'model' as const, label: uniqueModelId }))
    ]
  }

  private createProvider(provider: ExportedProvider): void {
    const { isEnabled, ...dto } = provider
    providerService.create(dto)
    if (isEnabled) providerService.update(provider.providerId, { isEnabled: true })
  }

  /** Clears `providerSettings` keys the file omits, since a merge patch removes a key only when it is null. */
  private replaceProvider(provider: ExportedProvider): void {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ providerSettings: userProviderTable.providerSettings })
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, provider.providerId))
      .all()
    const incoming = provider.providerSettings ?? {}
    const cleared = Object.fromEntries(
      Object.keys(row?.providerSettings ?? {})
        .filter((key) => !(key in incoming))
        .map((key) => [key, null])
    )

    providerService.update(
      provider.providerId,
      definedOnly({
        name: provider.name,
        endpointConfigs: provider.endpointConfigs,
        defaultChatEndpoint: provider.defaultChatEndpoint,
        authConfig: provider.authConfig,
        isEnabled: provider.isEnabled,
        providerSettings: { ...cleared, ...incoming }
      })
    )
    if (provider.apiKeys) providerService.replaceApiKeys(provider.providerId, provider.apiKeys)
  }

  private createModel(model: ExportedModel): void {
    const { isEnabled, isHidden, ...dto } = model
    modelService.create([{ dto, registryData: lookupRegistryForCreate(dto.providerId, dto.modelId) }])
    if (isEnabled === false || isHidden === true) {
      modelService.update(model.providerId, model.modelId, definedOnly({ isEnabled, isHidden }))
    }
  }

  /** Clears nullable limits the file omits; other absent fields keep their current value. */
  private replaceModel(model: ExportedModel): void {
    modelService.update(
      model.providerId,
      model.modelId,
      definedOnly({
        ...withoutKeys(model, ['providerId', 'modelId', 'presetModelId']),
        contextWindow: model.contextWindow ?? null,
        maxInputTokens: model.maxInputTokens ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null
      })
    )
  }
}

export const modelSettingsBackupService = new ModelSettingsBackupService()
