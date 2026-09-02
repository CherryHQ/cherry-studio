import type { ComposerFileKind } from '@renderer/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

export interface ComposerInputFilePreview {
  displayName: string
  previewPath: AbsoluteFilePath
  originalPath?: AbsoluteFilePath
  mediaType?: string
  composerFileKind?: ComposerFileKind
}

export type ComposerInputFilePreviewAction = (input: ComposerInputFilePreview) => void | Promise<void>
