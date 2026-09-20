import { readFile } from 'node:fs/promises'

import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { resolveSdkConfig } from '@main/ai/provider/sdkConfig'
import type { AppProviderSettingsMap } from '@main/ai/types'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { parseUniqueModelId, UniqueModelIdSchema, type UniqueModelId } from '@shared/data/types/model'
import type { FileInfo } from '@shared/types/file'
import { FILE_TYPE } from '@shared/types/file'
import { isProviderMediaTranscriptionModel } from '@shared/utils/mediaTranscriptionModels'
import { isSpeechToTextModel } from '@shared/utils/model'

import { getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'

const logger = loggerService.withContext('FileProcessing:providerMedia')

const AUDIO_PROMPT =
  'Transcribe the attached audio verbatim. Output only the transcript. If there is no speech, output an empty string.'

export const providerMediaAudioToTextHandler: FileProcessingCapabilityHandler<'audio_to_text'> = {
  mode: 'background',
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    if (file.type === FILE_TYPE.VIDEO) {
      throw new Error('provider-media only accepts audio; extract the audio track before transcription')
    }
    const uniqueModelId = resolveConfiguredModelId(config)

    return {
      mode: 'background',
      async execute(executionContext) {
        executionContext.signal.throwIfAborted()
        return { kind: 'text', text: await transcribeWithConfiguredModel(file, uniqueModelId, executionContext.signal) }
      }
    }
  }
}

function resolveConfiguredModelId(config: FileProcessorMerged): UniqueModelId {
  const capability = getRequiredCapability(config, 'audio_to_text', 'provider-media')
  const parsed = UniqueModelIdSchema.safeParse(capability.modelId?.trim())
  if (!parsed.success) {
    throw new Error('No transcription model is configured. Choose one in Settings > Audio / Video.')
  }
  return parsed.data
}

async function transcribeWithConfiguredModel(
  file: FileInfo,
  uniqueModelId: UniqueModelId,
  signal: AbortSignal
): Promise<string> {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  let model
  try {
    model = modelService.getByKey(providerId, modelId)
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      throw new Error(`Configured transcription model ${uniqueModelId} was not found.`)
    }
    throw error
  }

  if (file.type !== FILE_TYPE.AUDIO) {
    throw new Error(`Configured model ${uniqueModelId} cannot process audio.`)
  }

  const provider = providerService.getByProviderId(providerId)
  // Dedicated STT models belong on openai-transcription; provider-media needs
  // multimodal audio chat models on a converter that accepts audio file parts.
  if (isSpeechToTextModel(model)) {
    throw new Error(
      `Configured model ${uniqueModelId} is speech-to-text only; use the OpenAI Transcription processor instead of provider-media`
    )
  }
  if (!isProviderMediaTranscriptionModel(model, provider)) {
    throw new Error(`Configured model ${uniqueModelId} cannot process audio.`)
  }

  const resolvedEndpoint = resolveEffectiveEndpoint(provider, model)
  const { sdkConfig } = await resolveSdkConfig(provider, model, resolvedEndpoint)
  // Cap in-memory reads; oversized audio should already be chunked upstream.
  const MAX_INLINE_BYTES = 25_000_000
  if (file.size > MAX_INLINE_BYTES) {
    throw new Error(`Audio file exceeds ${MAX_INLINE_BYTES} bytes; chunk before transcription`)
  }
  const data = await readFile(file.path)
  if (data.byteLength > MAX_INLINE_BYTES) {
    throw new Error(`Audio file exceeds ${MAX_INLINE_BYTES} bytes; chunk before transcription`)
  }
  const filename = file.ext ? `${file.name}.${file.ext}` : file.name

  logger.debug('Generating transcript with configured model', {
    uniqueModelId,
    filename,
    mediaType: file.mime
  })

  const result = await aiCoreGenerateText<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
    model: sdkConfig.modelId,
    abortSignal: signal,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: AUDIO_PROMPT },
          { type: 'file', data, mediaType: file.mime, filename }
        ]
      }
    ]
  })

  return result.text ?? ''
}
