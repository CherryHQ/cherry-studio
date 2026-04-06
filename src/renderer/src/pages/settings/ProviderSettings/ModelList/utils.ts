import type { Model } from '@renderer/types'

export const isValidNewApiModel = (model: Model): boolean => {
  return !!(model.supported_endpoint_types && model.supported_endpoint_types.length > 0)
}
