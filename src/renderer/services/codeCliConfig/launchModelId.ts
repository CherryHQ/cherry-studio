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
 * Resolve the configured model id for a managed-tool launch (DeepSeek Harness /
 * OpenClaw). Returns null when no usable selection exists — after handling the
 * failure itself: a missing provider/modelId only toasts; an unparseable
 * modelId is treated as corrupt state and additionally clears the modelId and
 * the provider selection. (`useLaunchDialogController` keeps its own variant:
 * it validates the apply context, not the modelId, and preserves gateway
 * selections for retry.)
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
