import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { ZhipuPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { resolveCogviewSize } from '../../model/validators/cogviewSize'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultZhipuPainting } from './config'

export const zhipuProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'zhipu',
  dbMode: 'generate',
  // Model list is the user's enabled image-gen models for zhipu (DataApi
  // GET /models filtered by `supportsImageGenerationEndpoint`). The painting
  // page does not preselect or seed any models — if the user has none enabled,
  // the dropdown is empty by design.
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('zhipu')
  },
  createPaintingData: ({ modelOptions }) => createDefaultZhipuPainting(modelOptions),
  // Form is registry-derived (size + customSize + seed + negativePrompt + quality
  // when the selected model exposes it). The PaintingData persists `imageSize`,
  // so registryKeyMap aliases canonical `size` → `imageSize`.
  fields: [],
  useRegistryForm: true,
  registryKeyMap: { size: 'imageSize' },
  onModelChange: ({ modelId }) => ({ model: modelId }),
  // CogView's custom-size rules (range / divisible-by-16 / pixel-budget /
  // required-when-mode=custom) live in `resolveCogviewSize`. Other params
  // map by name (numImages→batchSize) — silicon/zhipu share the painting
  // canonical aiSdkParams shape.
  generate: (input) =>
    canonicalGenerate(input, {
      fieldMap: { batchSize: 'numImages' },
      resolvers: { imageSize: resolveCogviewSize }
    })
})
