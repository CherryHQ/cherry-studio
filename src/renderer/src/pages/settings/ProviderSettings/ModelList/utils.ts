import { Model, Provider } from '@renderer/types'

// Check if the model exists in the provider's model list
export const isModelInProvider = (provider: Provider, modelId: string): boolean => {
  return provider.models.some((m) => m.id === modelId)
}

export const isValidNewApiModel = (model: Model): boolean => {
  return !!(model.supported_endpoint_types && model.supported_endpoint_types.length > 0)
}
