import { createDefaultOvmsPainting } from './config'

export {
  createDefaultOvmsPainting,
  createOvmsConfig,
  DEFAULT_OVMS_PAINTING,
  getOvmsModels,
  OVMS_MODELS
} from './config'

export function createDefaultOvmsProviderPainting(models?: Array<{ label: string; value: string }>) {
  return createDefaultOvmsPainting(models)
}
