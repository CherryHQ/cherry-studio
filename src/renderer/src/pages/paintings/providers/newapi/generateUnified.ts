import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getEditImageFiles } from './editFiles'

/**
 * Unified newapi/cherryin/aionly painting adapter on the AI-SDK-native
 * files-driven image call (proven `providers/zhipu/generate.ts` pattern).
 *
 * The AI SDK has no separate "edit" call: a string prompt routes to
 * `/images/generations`; a `{ text, images }` prompt routes to `/images/edits`
 * (both `OpenAIImageModel` and `OpenAICompatibleImageModel` branch purely on
 * `files != null`). So we branch on whether edit images exist, NOT on `tab`.
 *
 * `quality`/`background`/`moderation` are forwarded verbatim (including the
 * `'auto'` sentinel, which `buildImageProviderOptions` omits) so the bespoke
 * `'auto'`-stripping behavior is preserved at the providerOptions layer.
 */
export async function generateWithNewApiUnified(input: GenerateInput<PaintingData>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  if (!apiKey) {
    throw createPaintingGenerateError('NO_API_KEY')
  }

  const prompt = painting.prompt?.trim()
  if (!prompt) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  const modelId = painting.model
  if (!modelId) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  return runPainting(async () => {
    const model = {
      id: modelId,
      provider: provider.id,
      name: modelId,
      group: ''
    } as Model

    const aiProvider = new AiProvider(model, {
      id: provider.id,
      type: 'openai',
      name: provider.name,
      apiKey,
      apiHost: provider.apiHost,
      models: [model],
      enabled: provider.isEnabled
    })

    const imageSize = painting.size && painting.size !== 'auto' ? painting.size : undefined

    const editFiles = getEditImageFiles(painting.id)

    let images: string[]
    if (editFiles.length > 0) {
      const inputImages = await Promise.all(
        editFiles.map(async (file) => new Uint8Array(await file.arrayBuffer()))
      )
      images = await aiProvider.editImage({
        model: modelId,
        prompt,
        inputImages,
        imageSize,
        quality: painting.quality,
        background: painting.background,
        moderation: painting.moderation,
        signal: abortController.signal
      })
    } else {
      images = await aiProvider.generateImage({
        model: modelId,
        prompt,
        imageSize: imageSize ?? '1024x1024',
        batchSize: painting.n ?? 1,
        quality: painting.quality,
        background: painting.background,
        moderation: painting.moderation,
        signal: abortController.signal
      })
    }

    if (images.length > 0) {
      return { base64s: images }
    }

    return undefined
  })
}
