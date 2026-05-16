import { loggerService } from '@logger'
import type { Model, Provider } from '@renderer/types'
import { isNewApiProvider } from '@renderer/utils/provider'
import type { TFunction } from 'i18next'

import NewApiBatchAddModelPopup from './NewApiBatchAddModelPopup'

const logger = loggerService.withContext('ModelListUtils')

// Check if the model exists in the provider's model list
export const isModelInProvider = (provider: Provider, modelId: string): boolean => {
  return provider.models.some((m) => m.id === modelId)
}

export const isValidNewApiModel = (model: Model): boolean => {
  return !!(model.supported_endpoint_types && model.supported_endpoint_types.length > 0)
}

/**
 * Add models with validation for New API providers.
 * For New API providers, shows a popup if any model lacks endpoint types.
 * Returns true if models were added, false otherwise.
 */
export const addModelsWithValidation = async (
  provider: Provider,
  modelsToAdd: Model[],
  onAddModel: (model: Model) => void,
  t: TFunction
): Promise<boolean> => {
  if (modelsToAdd.length === 0) return false

  try {
    if (isNewApiProvider(provider)) {
      if (modelsToAdd.every(isValidNewApiModel)) {
        modelsToAdd.forEach(onAddModel)
        return true
      } else {
        const result = await NewApiBatchAddModelPopup.show({
          title: t('settings.models.add.batch_add_models'),
          batchModels: modelsToAdd,
          provider
        })
        return result !== null && result?.success === true
      }
    } else {
      modelsToAdd.forEach(onAddModel)
      return true
    }
  } catch (error) {
    logger.error('Failed to add models', { error, count: modelsToAdd.length })
    window.toast.error(t('settings.models.manage.add_error'))
    return false
  }
}
