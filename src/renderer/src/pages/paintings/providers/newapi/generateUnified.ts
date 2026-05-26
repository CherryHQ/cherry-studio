import { AiProvider } from '@renderer/aiCore'
import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import type { Model } from '@renderer/types'

import { canonicalGenerate } from '../../model/canonicalGenerate'
import { runPainting } from '../../model/paintingGenerationService'
import type { OpenApiCompatiblePaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils/checkProviderEnabled'
import type { GenerateInput } from '../types'
import { getEditImageFiles } from './editFiles'

/**
 * Unified newapi/cherryin/aionly painting adapter.
 *
 * The AI SDK routes `/images/generations` vs `/images/edits` purely on
 * whether `files` are attached — so we branch on `editFiles.length > 0`, not
 * on `tab`. The edit branch calls `aiProvider.editImage` directly (no
 * URL-classification needed — gpt-image edits return base64 only). The
 * generate branch delegates to `canonicalGenerate` with newapi's
 * `painting.size === 'auto'` quirk encoded as a resolver.
 */
export async function generateWithNewApiUnified(input: GenerateInput<PaintingData>) {
  const { painting, provider, abortController } = input
  const editFiles = getEditImageFiles(painting.id)
  if (editFiles.length === 0) {
    return canonicalGenerate(input, {
      fieldMap: { batchSize: 'n' },
      // `painting.size === 'auto'` must omit `imageSize` entirely and set
      // `allowAutoSize: true` so AiProvider skips the 1024×1024 default.
      // Resolver returns undefined for 'auto', which skips the field — the
      // constant `allowAutoSize: true` below handles the rest.
      //
      // Registry-driven models (Nano Banana Pro etc., reached via this
      // fallback when their provider isn't in the painting registry) write
      // the resolution chip's value under `painting.imageSize` per the
      // registry keyMap. Fall through to that field when the legacy `size`
      // isn't set so those values reach the request body.
      resolvers: {
        imageSize: (p) => {
          if (p.size && p.size !== 'auto') return p.size
          const resolution = (p as unknown as Record<string, unknown>).imageSize
          return typeof resolution === 'string' && resolution !== '' ? resolution : undefined
        }
      },
      constants: { allowAutoSize: true }
    })
  }

  // Edit branch — stays bespoke because the AI SDK exposes edit through a
  // separate `editImage(...)` call (base64-only return, no URL classification).
  const apiKey = await checkProviderEnabled(provider)
  if (!apiKey) throw createPaintingGenerateError('NO_API_KEY')
  const prompt = painting.prompt?.trim()
  if (!prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')

  const imageSize = painting.size && painting.size !== 'auto' ? painting.size : undefined

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
