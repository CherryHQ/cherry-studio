import type { Model } from '@renderer/types'
import { isQwen35to39Model as sharedIsQwen35to39Model, isQwenMTModel as sharedIsQwenMTModel } from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'

export const isQwenMTModel = (model: Model): boolean => sharedIsQwenMTModel(toSharedCompatModel(model))

export const isQwen35to39Model = (model?: Model): boolean =>
  model ? sharedIsQwen35to39Model(toSharedCompatModel(model)) : false
