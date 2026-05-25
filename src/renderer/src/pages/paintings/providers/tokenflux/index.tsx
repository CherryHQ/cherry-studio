import { uuid } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import type { ModelOption } from '../../model/types/paintingModel'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { DEFAULT_TOKENFLUX_PAINTING } from './config'
import { tokenFluxFields } from './fields'
import { generateWithTokenFluxUnified } from './generateUnified'

export const tokenFluxProvider: PaintingProviderDefinition = createSingleModeProvider<TokenFluxPainting>({
  id: 'tokenflux',
  dbMode: 'generate',
  // Dropdown = user's enabled tokenflux image-gen models. Each option's
  // `raw` Model carries `imageGeneration.inputSchema` for the dynamic form
  // and `imageGeneration.modes` (kept implicit — tokenflux's painting page
  // is single-mode). No server fetch.
  models: {
    type: 'async',
    loader: async () => {
      const opts = (await loadPaintingModelOptions('tokenflux')) as ModelOption<Model>[]
      return opts.map((opt) => ({
        ...opt,
        group: opt.raw?.family ?? opt.group
      }))
    }
  },
  createPaintingData: () => ({
    ...DEFAULT_TOKENFLUX_PAINTING,
    id: uuid()
  }),
  fields: tokenFluxFields,
  onModelChange: ({ modelId }) => ({ model: modelId, inputParams: {} }),
  generate: (input) => generateWithTokenFluxUnified(input)
})

export { TokenFluxCenterContent, TokenFluxSetting } from './components'
