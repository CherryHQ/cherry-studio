import { AiProvider } from '@renderer/aiCore'
import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import {
  processPaintingResult as processResult,
  runPainting as runGeneration
} from '../../model/services/paintingGenerationService'
import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'
import { getEditImageFiles } from './editFiles'

type ImageResponseItem = {
  url?: string
  b64_json?: string
}

function buildRequestUrls(provider: GenerateContext['input']['provider']) {
  const baseUrl = provider.apiHost.replace(/\/v1$/, '')

  if (provider.id === 'aionly') {
    return {
      generateUrl: `${baseUrl}/openai/v1/images/generations`,
      editUrl: `${baseUrl}/openai/v1/images/edits`
    }
  }

  return {
    generateUrl: `${baseUrl}/v1/images/generations`,
    editUrl: `${baseUrl}/v1/images/edits`
  }
}

function buildGenerateRequestBody(painting: PaintingData, prompt: string, modelId: string) {
  return JSON.stringify({
    prompt,
    model: modelId,
    size: painting.size === 'auto' ? undefined : painting.size,
    background: painting.background === 'auto' ? undefined : painting.background,
    n: painting.n,
    quality: painting.quality === 'auto' ? undefined : painting.quality,
    moderation: painting.moderation === 'auto' ? undefined : painting.moderation
  })
}

function buildEditRequestBody(painting: PaintingData, prompt: string, modelId: string, files: File[]) {
  const formData = new FormData()

  formData.append('prompt', prompt)
  formData.append('model', modelId)

  if (painting.background && painting.background !== 'auto') {
    formData.append('background', painting.background)
  }
  if (painting.size && painting.size !== 'auto') {
    formData.append('size', painting.size)
  }
  if (painting.quality && painting.quality !== 'auto') {
    formData.append('quality', painting.quality)
  }
  if (painting.moderation && painting.moderation !== 'auto') {
    formData.append('moderation', painting.moderation)
  }

  files.forEach((file) => {
    formData.append('image', file)
  })

  return formData
}

async function ensureCleanOutput(painting: PaintingData) {
  if (painting.files.length === 0) {
    return true
  }

  const confirmed = await window.modal.confirm({
    content: i18next.t('paintings.regenerate.confirm'),
    centered: true
  })

  if (!confirmed) {
    return false
  }

  await FileManager.deleteFiles(painting.files)
  return true
}

export async function generateWithNewApi(ctx: GenerateContext) {
  const {
    input: { painting, provider, abortController, tab },
    writers: { patchPainting }
  } = ctx

  await checkProviderEnabled(provider)

  const canContinue = await ensureCleanOutput(painting)
  if (!canContinue) {
    return
  }

  const prompt = painting.prompt || ''
  patchPainting({ prompt } as Partial<PaintingData>)

  const aiProvider = new AiProvider(provider)
  const apiKey = aiProvider.getApiKey()

  if (!apiKey) {
    throw createPaintingGenerateError('NO_API_KEY')
  }

  if (!painting.model || !painting.prompt) {
    return
  }

  const modelId = painting.model

  await runGeneration(ctx, async () => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`
    }
    const { generateUrl, editUrl } = buildRequestUrls(provider)

    let body: string | FormData = ''
    let requestUrl = generateUrl

    if (tab === 'edit') {
      const editImages = getEditImageFiles(painting.id)

      if (editImages.length === 0) {
        throw createPaintingGenerateError('IMAGE_REQUIRED', {
          presentation: 'toast',
          severity: 'warning'
        })
      }

      body = buildEditRequestBody(painting, prompt, modelId, editImages)
      requestUrl = editUrl
    } else {
      body = buildGenerateRequestBody(painting, prompt, modelId)
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body,
      signal: abortController.signal
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: errorData.error?.message || i18next.t('paintings.generate_failed')
      })
    }

    const data = await response.json()
    const items = (data.data || []) as ImageResponseItem[]
    const urls = items.filter((item) => item.url).map((item) => item.url as string)
    const base64s = items.filter((item) => item.b64_json).map((item) => item.b64_json as string)

    if (urls.length > 0) {
      await processResult(ctx, { urls })
    }

    if (base64s.length > 0) {
      await processResult(ctx, { base64s })
    }
  })
}
