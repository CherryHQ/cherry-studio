import { useMemo } from 'react'

import type { Model } from '@shared/data/types/model'
import { archiveExts, audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file'

export interface ComposerFileCapabilities {
  canAddImageFile: boolean
  canAddTextFile: boolean
  supportedExts: string[]
}

interface ComposerFileCapabilitiesArgs {
  /** Mentioned models — unused for file-type gating; kept for call-site compatibility. */
  models: Model[]
  /** Model used when no models are mentioned (the assistant/agent model). */
  fallbackModel: Model | undefined
}

const EMPTY_MODELS: Model[] = []

const ALL_FILE_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts, ...archiveExts]

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
 *   model, OCR text otherwise), documents/text always extract, and audio/video always work
 *   (sent natively when the model accepts them, transcribed otherwise).
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

    return {
      canAddImageFile: true,
      canAddTextFile: true,
      supportedExts: [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]
    }
  }, [isChatSurface, models, fallbackModel])
}
