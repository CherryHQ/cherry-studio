import { uuid } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import type { ModelOption } from '../../model/types/paintingModel'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { DEFAULT_TOKENFLUX_PAINTING, type TokenFluxPainting } from './config'
import { tokenFluxFields } from './fields'
import { generateWithTokenFluxUnified } from './generateUnified'

export const tokenFluxProvider: PaintingProviderDefinition = createSingleModeProvider<TokenFluxPainting>({
  id: 'tokenflux',
  dbMode: 'generate',
  models: {
    type: 'async',
    loader: async () => {
      const opts = (await loadPaintingModelOptions('tokenflux')) as ModelOption<Model>[]
      return opts.map((opt) => ({ ...opt, group: opt.raw?.family ?? opt.group }))
    }
  },
  createPaintingData: () => ({ ...DEFAULT_TOKENFLUX_PAINTING, id: uuid() }),
  fields: tokenFluxFields,
  onModelChange: ({ modelId }) => ({ model: modelId, params: { inputParams: {} } }),
  generate: (input) => generateWithTokenFluxUnified(input)
})

export { TokenFluxCenterContent, TokenFluxSetting } from './components'
