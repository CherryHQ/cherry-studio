import { hasSupportedClipboardImage } from '@renderer/components/composer/composerPaste'
import { getFileExtension } from '@renderer/utils/file'
import { MAX_TRANSLATE_IMAGE_BYTES } from '@shared/utils/constants'
import { imageExts } from '@shared/utils/file'

/** Image extensions Translation accepts for clipboard paste / replace. */
export const TRANSLATE_CLIPBOARD_IMAGE_EXTS = [...imageExts]

export type TranslateClipboardImage = {
  name: string
  data: Uint8Array
  previewUrl: string
}

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
 * Capture clipboard image bytes and create a renderer-owned preview URL during
 * the paste gesture.
 */
export async function ingestTranslateClipboardImage(file: File): Promise<TranslateClipboardImage | null> {
  if (!file.type.startsWith('image/')) {
    return null
  }

  if (!TRANSLATE_CLIPBOARD_IMAGE_EXTS.includes(getFileExtension(file.name))) {
    return null
  }

  if (file.size <= 0 || file.size > MAX_TRANSLATE_IMAGE_BYTES) {
    return null
  }

  const data = new Uint8Array(await file.arrayBuffer())
  if (data.byteLength <= 0 || data.byteLength > MAX_TRANSLATE_IMAGE_BYTES) {
    return null
  }

  return { name: file.name, data, previewUrl: URL.createObjectURL(file) }
}
