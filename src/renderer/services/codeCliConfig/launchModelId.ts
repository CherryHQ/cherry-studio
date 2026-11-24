import i18n from '@renderer/i18n/resolver'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'

import { parseConfiguredModelId } from './applyContext'

const logger = loggerService.withContext('resolveLaunchModelId')

export type ConfiguredCliModelId = NonNullable<ReturnType<typeof parseConfiguredModelId>>

export interface ResolveLaunchModelIdArgs {
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
  errorToastKey: string
  logLabel: string
}

/**
 * Resolve the managed tool's launch model. An invalid stored ID clears the saved
 * model and provider selection so the user can configure them again.
 */
export async function resolveLaunchModelId({
  enabledProvider,
  currentProviderConfig,
  upsertProviderConfig,
  setCurrentProvider,
  errorToastKey,
  logLabel
}: ResolveLaunchModelIdArgs): Promise<ConfiguredCliModelId | null> {
  if (!enabledProvider || !currentProviderConfig?.modelId) {
    toast.error(i18n.t(errorToastKey))
    return null
  }
  const parsedModelId = parseConfiguredModelId(currentProviderConfig.modelId)
  if (!parsedModelId) {
    logger.error(logLabel, {
      modelId: currentProviderConfig.modelId,
      providerId: enabledProvider.id
    })
    await upsertProviderConfig(enabledProvider.id, { modelId: null })
    await setCurrentProvider(null)
    toast.error(i18n.t(errorToastKey))
    return null
  }
  return parsedModelId
}
