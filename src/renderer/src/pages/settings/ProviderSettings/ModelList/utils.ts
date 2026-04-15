import type { Model } from '@shared/data/types/model'

export const isValidNewApiModel = (model: Model): boolean => !!(model.endpointTypes && model.endpointTypes.length > 0)
