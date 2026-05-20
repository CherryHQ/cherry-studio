import { AiProvider } from '@renderer/aiCore'
import type { Model } from '@renderer/types'

import { generatePainting } from '../../model/generatePainting'
import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getEditImageFiles } from './editFiles'

/**
 * Unified newapi/cherryin/aionly painting adapter on the AI-SDK-native
 * files-driven image call.
 *
 * The AI SDK has no separate "edit" call: a string prompt routes to
 * `/images/generations`; a `{ text, images }` prompt routes to
 * `/images/edits` (both `OpenAIImageModel` and `OpenAICompatibleImageModel`
 * branch purely on `files != null`). We branch on whether edit images exist,
 * NOT on `tab`. The edit branch calls `aiProvider.editImage` directly (no
 * URL-classification needed — gpt-image edits return base64 only); the
 * generate branch goes through the shared `generatePainting` skeleton.
 *
 * `quality`/`background`/`moderation` are forwarded verbatim (including the
 * `'auto'` sentinel, which `buildImageProviderOptions` omits) so the bespoke
 * `'auto'`-stripping behavior is preserved at the providerOptions layer.
 */
export async function generateWithNewApiUnified(input: GenerateInput<PaintingData>) {
  const { painting, provider, abortController } = input
  const apiKey = await checkProviderEnabled(provider)
  if (!apiKey) throw createPaintingGenerateError('NO_API_KEY')
  const prompt = painting.prompt?.trim()
  if (!prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')

  const imageSize = painting.size && painting.size !== 'auto' ? painting.size : undefined
  const editFiles = getEditImageFiles(painting.id)

  // Edit branch — `aiProvider.editImage` (not `generatePaintingImage`) because
  // the AI SDK routes edits through `/images/edits` based on `files != null`.
  if (editFiles.length > 0) {
    return runPainting(async () => {
      const model: Model = { id: painting.model!, provider: provider.id, name: painting.model!, group: '' }
      const ai = new AiProvider(model, {
        id: provider.id,
        type: 'openai',
        name: provider.name,
        apiKey,
        apiHost: provider.apiHost,
        models: [model],
        enabled: provider.isEnabled
      })
      const inputImages = await Promise.all(editFiles.map(async (file) => new Uint8Array(await file.arrayBuffer())))
      const images = await ai.editImage({
        model: painting.model!,
        prompt,
        inputImages,
        imageSize,
        allowAutoSize: true,
        quality: painting.quality,
        background: painting.background,
        moderation: painting.moderation,
        signal: abortController.signal
      })
      return images.length > 0 ? { base64s: images } : undefined
    })
  }

  // Generate branch — `allowAutoSize:true` so `painting.size === 'auto'`
  // omits `size` entirely instead of being coerced to `1024x1024` (R2).
  return generatePainting({
    provider,
    signal: abortController.signal,
    apiKey,
    modelId: painting.model,
    prompt,
    aiSdkParams: {
      imageSize,
      allowAutoSize: true,
      batchSize: painting.n ?? 1,
      quality: painting.quality,
      background: painting.background,
      moderation: painting.moderation
    }
  })
}
