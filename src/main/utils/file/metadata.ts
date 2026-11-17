/**
 * File type detection and metadata utilities.
 *
 * Primary path: extension-based mapping. Fallback: a content sniff
 * (`isBinaryFile` + `chardet`) upgrades an extension-unknown file
 * (`FILE_TYPE.OTHER`) to `TEXT`. This lets uncommon or extension-less text
 * files — custom config/log formats users bring from many domains — be
 * recognized as text so they can be attached and used in chat, instead of
 * being rejected as non-text.
 */

import { open } from 'node:fs/promises'
import path from 'node:path'

import mime from 'mime'

import { decodeTextBufferIfText } from '../textEncoding'

export { decodeTextBufferIfText } from '../textEncoding'

import { type AbsoluteFilePath, FILE_TYPE, type FileType } from '@shared/types/file'
import { KB } from '@shared/utils/constants'
import { getFileTypeByExt } from '@shared/utils/file'

/**
 * Content-based text detection: reads the first 8 KB and delegates to
 * `decodeTextBufferIfText`, so it inherits the same encoding-aware handling
 * (UTF-8 plus high-confidence legacy encodings). Best-effort — returns `false`
 * on any read/detection error.
 *
 * A fixed byte window can end midway through a UTF-8, GB18030, or other
 * multibyte character, which decodes as invalid and would reject the whole
 * file. Read a few bytes past the window and retry at successive boundaries so
 * text is not rejected solely because the sample split a character.
 */
export async function isTextByContent(target: AbsoluteFilePath): Promise<boolean> {
  try {
    const length = 8 * KB
    const maxCharacterBytes = 4
    const fileHandle = await open(target, 'r')
    try {
      const buffer = Buffer.alloc(length + maxCharacterBytes)
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0)

      const firstEnd = Math.min(bytesRead, length)
      const lastEnd = Math.min(bytesRead, length + maxCharacterBytes)
      for (let end = firstEnd; end <= lastEnd; end++) {
        if (decodeTextBufferIfText(buffer.subarray(0, end)) !== null) return true
      }
      return false
    } finally {
      // Close on every path — a throwing read must not leak the descriptor.
      await fileHandle.close()
    }
  } catch {
    return false
  }
}

/**
 * Detect a file's `FileType`, **extension-first**.
 *
 * The extension is authoritative for every recognized type (image, video,
 * audio, document, text, …). A content sniff (`isTextByContent`) runs ONLY as a
 * fallback when the extension is unknown (`FILE_TYPE.OTHER`), to upgrade
 * extension-less / uncommon text files (custom config/log formats users bring
 * from many domains) to `TEXT` so they can be attached and previewed as text.
 *
 * ## Extension wins on mismatch (deliberate)
 *
 * When a file's bytes contradict its extension, the extension decides — content
 * is never sniffed for a recognized extension:
 * - binary bytes under a recognized text extension (e.g. a binary blob named
 *   `foo.txt`) → `TEXT`, not sniffed.
 * - text bytes under a recognized non-text extension (e.g. a text file named
 *   `foo.png`) → the extension's type (`IMAGE`), not `TEXT`.
 *
 * This trades a rare, usually-pathological misclassification for skipping a
 * content read on every recognized file. It is a deliberate change from the
 * legacy `File_IsTextFile`, which content-sniffed unconditionally. The blast
 * radius is bounded at the two consumers of this classification: the
 * attach/translate gate (`renderer/utils/file.ts` `isSupportedFile`) consults
 * its extension allowlist *before* this type, and the artifact preview gate
 * (`useIsTextFile`) is size-capped and visual-only — a mismatch degrades a
 * preview at worst, it cannot corrupt data or read an unbounded binary as text.
 * Callers that genuinely need content-based detection should call
 * `isTextByContent` directly instead.
 */
export async function getFileType(target: AbsoluteFilePath): Promise<FileType> {
  const ext = path.extname(target)
  const fileType = getFileTypeByExt(ext)
  return fileType === FILE_TYPE.OTHER && (await isTextByContent(target)) ? FILE_TYPE.TEXT : fileType
}

/** Map MIME type to file extension (without leading dot). Returns undefined if unknown. */
export function mimeToExt(mimeType: string): string | undefined {
  const ext = mime.getExtension(mimeType)
  return ext ?? undefined
}
