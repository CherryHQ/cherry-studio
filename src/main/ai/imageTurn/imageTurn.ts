import type { UIMessage } from 'ai'
import mime from 'mime'

import type { ParamValues } from '@cherrystudio/provider-registry'
import type { FileEntry } from '@shared/data/types/file'
import type { CherryMessagePart, FileUIPart } from '@shared/data/types/message'
import type { ImageGenerationMode, ImageGenerationSupport } from '@shared/data/types/model'
import { readCherryMeta, withCherryMeta } from '@shared/data/types/uiParts'
import type { FileUrlString } from '@shared/types/file'

import { collectComposerFileTokenIds, isActiveManagedFilePart } from '../messages/composerFileParts'

export interface ImageTurnInput {
  prompt: string
  inputImageIds: string[]
  mode: Extract<ImageGenerationMode, 'generate' | 'edit'>
}

function imageIds(message: UIMessage): string[] {
  const composerFileTokenIds = collectComposerFileTokenIds(message)
  return message.parts.flatMap((part) => {
    if (part.type !== 'file' || !part.mediaType.startsWith('image/')) return []
    if (!isActiveManagedFilePart(part, composerFileTokenIds)) return []
    const id = readCherryMeta(part)?.fileEntryId
    return id ? [id] : []
  })
}

function assertModeSupported(mode: ImageTurnInput['mode'], support: ImageGenerationSupport | null | undefined): void {
  if (support && !support.modes[mode]) {
    throw Object.assign(
      new Error(
        mode === 'edit'
          ? 'This image model does not support editing the previous image.'
          : 'This image model requires an input image.'
      ),
      { i18nKey: mode === 'edit' ? 'image_edit_unsupported' : 'image_input_required' }
    )
  }
}

/** An inherited image is always an edit; attached ones edit only when the model declares that mode. */
function resolveMode(
  hasReference: boolean,
  support: ImageGenerationSupport | null | undefined,
  inherited: boolean
): ImageTurnInput['mode'] {
  if (!hasReference) return 'generate'
  return inherited || support?.modes.edit || !support ? 'edit' : 'generate'
}

/** Select prompt and edit references from the active branch supplied by the stream manager. */
export function collectImageTurnInput(
  messages: readonly UIMessage[] | undefined,
  support?: ImageGenerationSupport | null
): ImageTurnInput {
  const user = messages?.findLast((message) => message.role === 'user')
  if (!user)
    throw Object.assign(new Error('No user message found for image generation.'), { i18nKey: 'image_prompt_required' })

  const prompt = user.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()

  const currentImages = imageIds(user)
  // Only an edit-capable model inherits a reference from the branch above the current prompt.
  const inherited = support?.modes.edit
    ? messages
        ?.slice(0, messages.lastIndexOf(user))
        .findLast((message) => message.role === 'assistant' && imageIds(message).length > 0)
    : undefined
  const referenceIds = currentImages.length > 0 ? currentImages : inherited ? imageIds(inherited) : []
  const mode = resolveMode(referenceIds.length > 0, support, inherited !== undefined)
  assertModeSupported(mode, support)
  if (!prompt && support?.modes[mode]?.requirePrompt !== false)
    throw Object.assign(new Error('Image generation requires a text prompt.'), { i18nKey: 'image_prompt_required' })
  // An undeclared maximum imposes no local input-image limit.
  const uniqueIds = [...new Set(referenceIds)]
  const limit = support?.modes[mode]?.maxInputImages
  return { prompt, inputImageIds: limit ? uniqueIds.slice(0, limit) : uniqueIds, mode }
}

/** Materialize a mode's registry defaults — the only parameter source a chat-started image request has. */
export function imageTurnParamValues(
  mode: ImageGenerationMode,
  support: ImageGenerationSupport | null | undefined
): ParamValues {
  const supports = support?.modes[mode]?.supports
  if (!supports) return {}
  return Object.fromEntries(
    Object.entries(supports).flatMap(([key, spec]) => {
      if (!('default' in spec) || spec.default === undefined) return []
      return [[key, spec.default]]
    })
  )
}

export function imageTurnFileParts(
  files: readonly FileEntry[],
  getUrl: (id: string) => FileUrlString
): CherryMessagePart[] {
  return files.map((file) => {
    const ext = file.ext || 'png'
    const mediaType = mime.getType(`image.${ext}`) ?? 'image/png'
    const part: FileUIPart = {
      type: 'file',
      mediaType,
      filename: file.ext ? `${file.name}.${file.ext}` : file.name,
      url: getUrl(file.id)
    }
    return withCherryMeta(part, { fileEntryId: file.id })
  })
}
