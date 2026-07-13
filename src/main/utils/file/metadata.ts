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
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await fileHandle.read(buffer, 0, length, 0)
    await fileHandle.close()

    const matches = chardet.analyse(buffer.subarray(0, bytesRead))
    return matches.length > 0 && matches[0].confidence > 0.8
  } catch {
    return false
  }
}

/**
 * Detect file type from extension, upgrading an extension-unknown file
 * (`FILE_TYPE.OTHER`) to `TEXT` when its content sniffs as text.
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
