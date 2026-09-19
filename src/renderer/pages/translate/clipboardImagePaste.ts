import { hasSupportedClipboardImage } from '@renderer/components/composer/composerPaste'
import type { FileMetadata } from '@renderer/types/file'
import { getFileExtension } from '@renderer/utils/file'
import { imageExts } from '@shared/utils/file'

/** Image extensions Translation accepts for clipboard paste / replace. */
export const TRANSLATE_CLIPBOARD_IMAGE_EXTS = [...imageExts]

/**
 * Whether clipboard paste should prefer an image over a coexisting text flavor.
 * Matches chat composer behavior for Windows screenshot clipboards.
 */
export function shouldPreferTranslateClipboardImage(
  files: readonly Pick<File, 'name' | 'type'>[],
  supportedExts: readonly string[] = TRANSLATE_CLIPBOARD_IMAGE_EXTS
): boolean {
  return hasSupportedClipboardImage(files, supportedExts)
}

/**
 * Persist a clipboard `File` (path-backed or pathless image bytes) into a
 * `FileMetadata` the translate page can preview and send.
 */
export async function ingestTranslateClipboardImage(file: File): Promise<FileMetadata | null> {
  const filePath = window.api.file.getPathForFile(file)
  if (filePath) {
    return window.api.file.get(filePath)
  }

  if (!file.type.startsWith('image/')) {
    return null
  }

  if (!TRANSLATE_CLIPBOARD_IMAGE_EXTS.includes(getFileExtension(file.name))) {
    return null
  }

  const tempFilePath = await window.api.file.createTempFile(file.name)
  const arrayBuffer = await file.arrayBuffer()
  await window.api.file.write(tempFilePath, new Uint8Array(arrayBuffer))
  return window.api.file.get(tempFilePath)
}
