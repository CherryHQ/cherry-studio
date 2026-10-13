import { useMemo } from 'react'

import { anyFileExt } from '@renderer/utils/file'
import type { Model } from '@shared/data/types/model'
import { archiveExts, audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file'

export interface ComposerFileCapabilities {
  canAddImageFile: boolean
  canAddTextFile: boolean
  supportedExts: string[]
}

interface ComposerFileCapabilitiesArgs {
  models: Model[]
  /** Model used when no models are mentioned (the assistant/agent model). */
  fallbackModel: Model | undefined
}

const CHAT_FILE_EXTS = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts]
const ALL_FILE_EXTS = [...CHAT_FILE_EXTS, ...archiveExts]

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
 * - **Chat**: images, documents, text, and known audio/video can be attached.
 *   Native delivery versus analysis fallback is chosen later, per model.
 *   WebM is in the shared video extensions and is probed before that choice.
 */
export function useComposerFileCapabilities(model: Model | undefined): ComposerFileCapabilities
export function useComposerFileCapabilities(args: ComposerFileCapabilitiesArgs): ComposerFileCapabilities
export function useComposerFileCapabilities(
  input: Model | undefined | ComposerFileCapabilitiesArgs
): ComposerFileCapabilities {
  const isChatSurface = isMultiModelArgs(input)
  const fallbackModel = isChatSurface ? undefined : input

  return useMemo(() => {
    // Agent reads attachments from disk by path → all file types, any active model.
    if (!isChatSurface) {
      const enabled = fallbackModel != null
      // The modality lists stay for callers that read them as a catalog (dialog
      // filters, image-paste detection); `anyFileExt` is what lifts the filter.
      return {
        canAddImageFile: enabled,
        canAddTextFile: enabled,
        supportedExts: enabled ? [...ALL_FILE_EXTS, anyFileExt] : []
      }
    }
    return {
      canAddImageFile: true,
      canAddTextFile: true,
      supportedExts: [...CHAT_FILE_EXTS]
    }
  }, [isChatSurface, fallbackModel])
}
