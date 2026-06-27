import {
  isAudioModel,
  isAudioModels,
  isGenerateImageModel,
  isGenerateImageModels,
  isVideoModel,
  isVideoModels,
  isVisionModel,
  isVisionModels
} from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import { audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file/fileExtensions'
import { useMemo } from 'react'

export interface ComposerFileCapabilities {
  canAddImageFile: boolean
  canAddTextFile: boolean
  supportedExts: string[]
}

interface ComposerFileCapabilitiesArgs {
  /** Mentioned models — vision/image support requires ALL of them to qualify. */
  models: Model[]
  /** Model used when no models are mentioned (the assistant/agent model). */
  fallbackModel: Model | undefined
}

const EMPTY_MODELS: Model[] = []

/** Each gateable input modality → the predicate pair that probes whether the active
 *  model set supports it (single model vs. every mentioned model). */
const MEDIA_INPUT_PREDICATES = {
  vision: [isVisionModel, isVisionModels],
  imageGen: [isGenerateImageModel, isGenerateImageModels],
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
 * The args-object form is the **chat** surface; the bare-model form is the **agent**
 * surface. They differ because chat runs every attachment through the main-process
 * router (`prepareChatMessages`), which inlines any non-native file as extracted/OCR'd
 * text — so on chat an image is always acceptable (sent natively to a vision model,
 * OCR text otherwise) and document/text files always work, regardless of the model.
 * The agent runs on a separate runtime with no text-extraction fallback, so it stays
 * gated on the model's native input modalities (vision / edit-image for images).
 *
 * Audio/video have no text fallback on either surface, so both gate them strictly on
 * the model's audio/video input capability. Vision / image support requires every
 * mentioned model to qualify, or — with none mentioned — the fallback model.
 */
export function useComposerFileCapabilities(model: Model | undefined): ComposerFileCapabilities
export function useComposerFileCapabilities(args: ComposerFileCapabilitiesArgs): ComposerFileCapabilities
export function useComposerFileCapabilities(
  input: Model | undefined | ComposerFileCapabilitiesArgs
): ComposerFileCapabilities {
  const isChatSurface = isMultiModelArgs(input)
  const { models, fallbackModel } = isChatSurface ? input : { models: EMPTY_MODELS, fallbackModel: input }

  return useMemo(() => {
    const supports = ([single, plural]: (typeof MEDIA_INPUT_PREDICATES)[keyof typeof MEDIA_INPUT_PREDICATES]) =>
      models.length > 0 ? plural(models) : fallbackModel ? single(fallbackModel) : false

    const vision = supports(MEDIA_INPUT_PREDICATES.vision)
    const imageGen = supports(MEDIA_INPUT_PREDICATES.imageGen)
    const audio = supports(MEDIA_INPUT_PREDICATES.audio)
    const video = supports(MEDIA_INPUT_PREDICATES.video)

    // Chat OCRs images for any model and always extracts document/text; agent has no
    // text fallback, so it stays native-only (vision / edit-image, and no text for a
    // pure image generator). Audio/video have no fallback anywhere → strict capability.
    const canAddImageFile = isChatSurface || vision || imageGen
    const canAddTextFile = isChatSurface || vision || !imageGen

    const supportedExts = [
      ...(canAddImageFile ? imageExts : []),
      ...(audio ? audioExts : []),
      ...(video ? videoExts : []),
      ...(canAddTextFile ? [...documentExts, ...textExts] : [])
    ]
    return { canAddImageFile, canAddTextFile, supportedExts }
  }, [isChatSurface, models, fallbackModel])
}
