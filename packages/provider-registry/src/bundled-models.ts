import data from '../data/models.json'
import type { ModelSnapshot } from './registry'
import { ModelListSchema } from './schemas/model'

export const bundledModels: ModelSnapshot['models'] = ModelListSchema.parse(data)
