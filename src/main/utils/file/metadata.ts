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

import { FILE_TYPE, type FilePath, type FileType } from '@shared/types/file'
import { KB } from '@shared/utils/constants'
import { getFileTypeByExt } from '@shared/utils/file'
import chardet from 'chardet'
import { isBinaryFile } from 'isbinaryfile'
import mime from 'mime'

/**
 * Content-based text detection: the file is not binary AND `chardet` identifies
 * an encoding with high confidence from the first 8 KB. Best-effort — returns
 * `false` on any read/detection error.
 */
export async function isTextByContent(target: FilePath): Promise<boolean> {
  try {
    if (await isBinaryFile(target)) {
      return false
    }

    const length = 8 * KB
    const fileHandle = await open(target, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await fileHandle.read(buffer, 0, length, 0)
      const matches = chardet.analyse(buffer.subarray(0, bytesRead))
      return matches.length > 0 && matches[0].confidence > 0.8
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
export async function getFileType(target: FilePath): Promise<FileType> {
  const ext = path.extname(target)
  const fileType = getFileTypeByExt(ext)
  return fileType === FILE_TYPE.OTHER && (await isTextByContent(target)) ? FILE_TYPE.TEXT : fileType
}

/** Map MIME type to file extension (without leading dot). Returns undefined if unknown. */
export function mimeToExt(mimeType: string): string | undefined {
  const ext = mime.getExtension(mimeType)
  return ext ?? undefined
}
