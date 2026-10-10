import type { ImageModelV4 } from '@ai-sdk/provider'

import { t } from '@main/i18n'
import type { ResolvedImageGenerationSupport } from '@shared/ai/imageGeneration'
import type { ImageGenerationSupport } from '@shared/data/types/model'

export async function resolveImageInputCapabilities(
  support: ImageGenerationSupport | null,
  acceptsImages: boolean,
  model: Pick<ImageModelV4, 'supportsFileInputs' | 'supportsMaskInputs'>
): Promise<ResolvedImageGenerationSupport> {
  const [sdkFiles, mask] = await Promise.all([model.supportsFileInputs, model.supportsMaskInputs])
  const registryFiles =
    acceptsImages ||
    Object.entries(support?.modes ?? {}).some(
      ([mode, definition]) => mode !== 'generate' || !!definition.maxInputImages
    ) ||
    undefined
  const files = sdkFiles ?? registryFiles
  const modes = { ...(support?.modes ?? { generate: { supports: {} } }) }

  if (files !== true) {
    for (const mode of Object.keys(modes) as Array<keyof typeof modes>) {
      if (mode !== 'generate') delete modes[mode]
    }
  }

  return { modes, inputCapabilities: { files, mask } }
}

export function validateImageInputs(
  request: { inputImages?: readonly string[]; mask?: string },
  support: ResolvedImageGenerationSupport
): void {
  if (request.mask !== undefined && !request.inputImages?.length) {
    throw new Error(t('paintings.mask_requires_image'))
  }
  if (request.inputImages?.length && support.inputCapabilities.files !== true) {
    throw new Error(t('paintings.input_images_not_supported'))
  }
  if (request.mask !== undefined && support.inputCapabilities.mask !== true) {
    throw new Error(t('paintings.mask_not_supported'))
  }
}
