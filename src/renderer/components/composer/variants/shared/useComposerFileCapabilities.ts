import { isAudioModel, isAudioModels, isVideoModel, isVideoModels } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file/fileExtensions'
import { useMemo } from 'react'

export interface ComposerFileCapabilities {
  canAddImageFile: boolean
  canAddTextFile: boolean
  supportedExts: string[]
}

interface ComposerFileCapabilitiesArgs {
  /** Mentioned models — audio/video support requires ALL of them to qualify. */
  models: Model[]
  /** Model used when no models are mentioned (the assistant/agent model). */
  fallbackModel: Model | undefined
}

const EMPTY_MODELS: Model[] = []

const ALL_FILE_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]

// audio/video are the only modalities the chat surface still gates on (images always work
// via the OCR fallback, documents/text always extract). Each maps to the predicate pair
// that probes whether the active model set supports it (single model vs. every mentioned).
const MEDIA_INPUT_PREDICATES = {
  audio: [isAudioModel, isAudioModels],
  video: [isVideoModel, isVideoModels]
} as const satisfies Record<string, readonly [(model: Model) => boolean, (models: Model[]) => boolean]>

function isMultiModelArgs(
  input: Model | undefined | ComposerFileCapabilitiesArgs
): input is ComposerFileCapabilitiesArgs {
  return !!input && Array.isArray((input as ComposerFileCapabilitiesArgs).models)
}

/**
 * Derives which file kinds the composer accepts from the active model(s).
 *
 * The args-object form is the **chat** surface; the bare-model form is the **agent** surface.
 *
 * - **Agent**: attachments are forwarded to the agent runtime as absolute file paths and read
 *   by the agent's own tools, so the model's modality is irrelevant — every file type is
 *   attachable on any active model.
 * - **Chat**: the model consumes files directly. Images always work (sent natively to a vision
 *   model, OCR text otherwise) and documents/text always extract, regardless of the model.
 *   Audio/video have no text fallback, so they gate on the model's audio/video input
 *   capability — every mentioned model must qualify, or (with none mentioned) the fallback.
 */
export function useComposerFileCapabilities(model: Model | undefined): ComposerFileCapabilities
export function useComposerFileCapabilities(args: ComposerFileCapabilitiesArgs): ComposerFileCapabilities
export function useComposerFileCapabilities(
  input: Model | undefined | ComposerFileCapabilitiesArgs
): ComposerFileCapabilities {
  const isChatSurface = isMultiModelArgs(input)
  const { models, fallbackModel } = isChatSurface ? input : { models: EMPTY_MODELS, fallbackModel: input }

  return useMemo(() => {
    // Agent reads attachments from disk by path → all file types, any active model.
    if (!isChatSurface) {
      const enabled = fallbackModel != null
      return {
        canAddImageFile: enabled,
        canAddTextFile: enabled,
        supportedExts: enabled ? [...ALL_FILE_EXTS] : []
      }
    }

    const supports = ([single, plural]: (typeof MEDIA_INPUT_PREDICATES)[keyof typeof MEDIA_INPUT_PREDICATES]) =>
      models.length > 0 ? plural(models) : fallbackModel ? single(fallbackModel) : false
    const audio = supports(MEDIA_INPUT_PREDICATES.audio)
    const video = supports(MEDIA_INPUT_PREDICATES.video)
    return {
      canAddImageFile: true,
      canAddTextFile: true,
      supportedExts: [
        ...imageExts,
        ...(audio ? audioExts : []),
        ...(video ? videoExts : []),
        ...documentExts,
        ...textExts
      ]
    }
  }, [isChatSurface, models, fallbackModel])
}
