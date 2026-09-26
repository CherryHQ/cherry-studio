import type { AbsoluteFilePath } from '@shared/types/file'

import type { ComposerFileKind } from './file'

export interface InputFilePreview {
  displayName: string
  previewPath: AbsoluteFilePath
  originalPath?: AbsoluteFilePath
  mediaType?: string
  composerFileKind?: ComposerFileKind
}

export type InputFilePreviewAction = (input: InputFilePreview) => void | Promise<void>
