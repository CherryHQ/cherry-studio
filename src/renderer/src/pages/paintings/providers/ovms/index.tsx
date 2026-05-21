import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import type { TFunction } from 'i18next'

import { SettingHelpLink } from '../../../settings'
import { canonicalGenerate } from '../../model/canonicalGenerate'
import type { OvmsPaintingData as PaintingData } from '../../model/types/paintingData'
import { loadPaintingModelOptions } from '../../model/utils/paintingModelOptions'
import { createSingleModeProvider, type PaintingProviderDefinition } from '../types'
import { createDefaultOvmsPainting, OVMS_MODELS } from './defaults'

export function OvmsHeaderActions({ t }: { t: TFunction }) {
  const Icon = resolveProviderIcon('ovms')
  return (
    <SettingHelpLink target="_blank" href="https://docs.openvino.ai/2025/model-server/ovms_demos_image_generation.html">
      {t('paintings.learn_more')}
      {Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null}
    </SettingHelpLink>
  )
}

export const ovmsProvider: PaintingProviderDefinition = createSingleModeProvider<PaintingData>({
  id: 'ovms',
  dbMode: 'generate',
  models: {
    type: 'async',
    loader: () => loadPaintingModelOptions('ovms')
  },
  createPaintingData: ({ modelOptions }) => createDefaultOvmsPainting(modelOptions),
  // Field list comes from the registry's provider-level `paintingDefaults`
  // (see packages/provider-registry/data/providers.json) — OVMS users
  // register arbitrary local model ids, so per-model registry entries
  // can't be enumerated, but the API contract (size / num_inference_steps
  // / rng_seed) is fixed provider-wide. keyMap aliases canonical keys to
  // OVMS's snake_case persisted field names.
  useRegistryForm: true,
  fields: [],
  onModelChange: ({ modelId }) => ({ model: modelId }),
  prompt: {
    disabled: ({ painting, isLoading }) => isLoading || !painting.model || painting.model === OVMS_MODELS[0]?.value
  },
  // OVMS is auth-less (local OpenVINO Model Server) — `noAuth: true` skips
  // `checkProviderEnabled`. The bespoke snake-case extras (`num_inference_steps`,
  // `rng_seed`) go through `providerBag` since they don't fit the canonical
  // AI-SDK aiSdkParams shape.
  generate: (input) =>
    canonicalGenerate(input, {
      noAuth: true,
      fieldMap: { imageSize: 'size' },
      defaults: { imageSize: '512x512', batchSize: 1 },
      providerBag: (painting) => ({
        model: painting.model,
        size: painting.size,
        numInferenceSteps: painting.num_inference_steps,
        rngSeed: painting.rng_seed
      })
    })
})
