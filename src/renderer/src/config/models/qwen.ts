import type { Model } from '@shared/data/types/model'
import { isQwen35to39Model as sharedIsQwen35to39Model, isQwenMTModel as sharedIsQwenMTModel } from '@shared/utils/model'

export const isQwenMTModel = (model: Model): boolean => sharedIsQwenMTModel(model)

export const isQwen35to39Model = (model?: Model): boolean => (model ? sharedIsQwen35to39Model(model) : false)
