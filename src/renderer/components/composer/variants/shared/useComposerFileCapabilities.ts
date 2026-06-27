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

  const isVisionSupported = useMemo(
    () => (models.length > 0 ? isVisionModels(models) : fallbackModel ? isVisionModel(fallbackModel) : false),
    [models, fallbackModel]
  )
  const isGenerateImageSupported = useMemo(
    () =>
      models.length > 0 ? isGenerateImageModels(models) : fallbackModel ? isGenerateImageModel(fallbackModel) : false,
    [models, fallbackModel]
  )
  const isAudioSupported = useMemo(
    () => (models.length > 0 ? isAudioModels(models) : fallbackModel ? isAudioModel(fallbackModel) : false),
    [models, fallbackModel]
  )
  const isVideoSupported = useMemo(
    () => (models.length > 0 ? isVideoModels(models) : fallbackModel ? isVideoModel(fallbackModel) : false),
    [models, fallbackModel]
  )

  // Chat OCRs images for any model; agent stays native-only (vision / edit-image).
  const canAddImageFile = isChatSurface || isVisionSupported || isGenerateImageSupported
  // Chat always extracts text; agent disallows it only for a pure image generator.
  const canAddTextFile = isChatSurface || isVisionSupported || !isGenerateImageSupported
  const canAddAudioFile = isAudioSupported
  const canAddVideoFile = isVideoSupported

  const supportedExts = useMemo(() => {
    const exts: string[] = []
    if (canAddImageFile) exts.push(...imageExts)
    if (canAddAudioFile) exts.push(...audioExts)
    if (canAddVideoFile) exts.push(...videoExts)
    if (canAddTextFile) exts.push(...documentExts, ...textExts)
    return exts
  }, [canAddImageFile, canAddAudioFile, canAddVideoFile, canAddTextFile])

  return { canAddImageFile, canAddTextFile, supportedExts }
}
