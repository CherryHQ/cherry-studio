import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import type { Model } from '@shared/data/types/model'
import { documentExts, imageExts, textExts } from '@shared/utils/file/fileExtensions'
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
 * Agent passes a single resolved `model`; chat passes its mentioned `models` plus a
 * `fallbackModel` (the assistant model used when nothing is mentioned). Vision / image
 * support requires every mentioned model to qualify, or — with none mentioned — the
 * fallback model.
 */
export function useComposerFileCapabilities(model: Model | undefined): ComposerFileCapabilities
export function useComposerFileCapabilities(args: ComposerFileCapabilitiesArgs): ComposerFileCapabilities
export function useComposerFileCapabilities(
  input: Model | undefined | ComposerFileCapabilitiesArgs
): ComposerFileCapabilities {
  const { models, fallbackModel } = isMultiModelArgs(input) ? input : { models: EMPTY_MODELS, fallbackModel: input }

  const isVisionSupported = useMemo(
    () => (models.length > 0 ? isVisionModels(models) : fallbackModel ? isVisionModel(fallbackModel) : false),
    [models, fallbackModel]
  )
  const isGenerateImageSupported = useMemo(
    () =>
      models.length > 0 ? isGenerateImageModels(models) : fallbackModel ? isGenerateImageModel(fallbackModel) : false,
    [models, fallbackModel]
  )
  const canAddImageFile = isVisionSupported || isGenerateImageSupported
  const canAddTextFile = isVisionSupported || (!isVisionSupported && !isGenerateImageSupported)

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) return [...imageExts, ...documentExts, ...textExts]
    if (canAddImageFile) return [...imageExts]
    if (canAddTextFile) return [...documentExts, ...textExts]
    return []
  }, [canAddImageFile, canAddTextFile])

  return { canAddImageFile, canAddTextFile, supportedExts }
}
