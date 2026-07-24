/**
 * Attachment → plain text extraction for chat messages and `read_file`.
 *
 * Single home for "turn a non-natively-consumable attachment into text":
 *   - `pdf`                          → `extractPdfText` (`@main/utils/pdf`)
 *   - `doc`                          → `word-extractor`
 *   - `docx/pptx/xlsx/xls/od*`       → `officeparser`
 *   - `zip` images                    → configured image OCR processor
 *   - everything else (text / code)  → encoding-aware text detection for
 *                                       extensionless files, then decode
 *
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { isAbortError } from '@ai-sdk/provider-utils'
import { application } from '@application'
import { loggerService } from '@logger'
import { decodeTextBufferIfText } from '@main/utils/file'
import { decodeTextWithAutoEncoding } from '@main/utils/legacyFile'
import { extractPdfText } from '@main/utils/pdf'
import type { FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'
import { documentExts, imageExts } from '@shared/utils/file'
import StreamZip from 'node-stream-zip'
import officeParser from 'officeparser'
import WordExtractor from 'word-extractor'

const logger = loggerService.withContext('ai:documentExtraction')

/** Bare extensions officeparser handles — `documentExts` minus PDF (own parser) and `doc` (word-extractor). */
const OFFICE_PARSER_EXTS = new Set(
  documentExts.map((ext) => ext.replace(/^\./, '')).filter((ext) => ext !== 'pdf' && ext !== 'doc')
)

const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_ZIP_ENTRIES = 1000
const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_ZIP_IMAGES = 20
const MAX_ZIP_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_EXTS = new Set<string>(imageExts)

/** Model-facing note when a document yields no extractable text (scanned / image-only). */
export function noExtractableTextNote(filename: string): string {
  return `No extractable text found in "${filename}" — it may be a scanned or image-only document.`
}

async function extract(entryId: FileEntryId, ext: string): Promise<string | null> {
  const { content } = await application.get('FileManager').read(entryId, { encoding: 'binary' })

  if (ext === 'pdf') return (await extractPdfText(content)).trim()

  const buffer = Buffer.from(content)
  if (ext === 'doc') {
    const extracted = await new WordExtractor().extract(buffer)
    return extracted.getBody().trim()
  }
  if (OFFICE_PARSER_EXTS.has(ext)) {
    const text = await officeParser.parseOfficeAsync(buffer, { tempFilesLocation: application.getPath('app.temp') })
    return text.trim()
  }
  if (!ext) return decodeTextBufferIfText(buffer)?.trim() ?? null
  return decodeTextWithAutoEncoding(buffer).trim()
}

/**
 * Extract plain text from a file entry. Returns `null` when an extensionless
 * file is detected as binary, and may return an empty string for scanned /
 * image-only docs (the caller emits {@link noExtractableTextNote}). Throws on
 * unreadable file / parse failure, and rethrows the abort reason if `signal`
 * is aborted.
 */
export async function extractDocumentText(
  entryId: FileEntryId,
  opts: { signal?: AbortSignal } = {}
): Promise<string | null> {
  const fileManager = application.get('FileManager')
  const cache = application.get('CacheService')

  const version = await fileManager.getVersion(entryId)
  const cacheKey = `doc-extraction:${entryId}:${version.mtime}:${version.size}`
  const cached = cache.get<string | null>(cacheKey)
  if (cached !== undefined) return cached

  if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('Aborted')
  const entry = await fileManager.getById(entryId)
  const ext = entry.ext?.toLowerCase() ?? ''
  const text = await extract(entryId, ext)

  logger.debug('Processed document text', { entryId, ext, chars: text?.length ?? 0, binary: text === null })
  cache.set(cacheKey, text, CACHE_TTL_MS)
  return text
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
}

function imageExtension(entryName: string): string | null {
  const ext = path.posix.extname(entryName).toLowerCase()
  return IMAGE_EXTS.has(ext) ? ext : null
}

async function extractZipImages(entryId: FileEntryId, signal?: AbortSignal): Promise<string> {
  const zipPath = application.get('FileManager').getPhysicalPath(entryId)
  const zip = new StreamZip.async({ file: zipPath })
  let tempDir: string | undefined

  try {
    throwIfAborted(signal)
    const entries = Object.values(await zip.entries())
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new Error(`ZIP has too many entries (${entries.length}; maximum ${MAX_ZIP_ENTRIES})`)
    }
    const files = entries.filter((entry) => !entry.isDirectory)

    const totalSize = files.reduce((sum, entry) => sum + entry.size, 0)
    if (totalSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(`ZIP uncompressed size exceeds ${MAX_ZIP_UNCOMPRESSED_BYTES} bytes`)
    }

    const imageEntries = files.flatMap((entry) => {
      const ext = imageExtension(entry.name)
      return ext ? [{ entry, ext }] : []
    })
    if (imageEntries.length === 0) return 'No supported image files found in this ZIP archive.'

    tempDir = await fs.mkdtemp(application.getPath('app.temp', 'chat-archive-'))
    const sections: string[] = []
    for (const [index, { entry, ext }] of imageEntries.slice(0, MAX_ZIP_IMAGES).entries()) {
      throwIfAborted(signal)
      if (entry.encrypted) {
        sections.push(`Image "${entry.name}": [encrypted image skipped].`)
        continue
      }
      if (entry.size > MAX_ZIP_IMAGE_BYTES) {
        sections.push(`Image "${entry.name}": [image exceeds the ${MAX_ZIP_IMAGE_BYTES}-byte limit].`)
        continue
      }

      try {
        const data = await zip.entryData(entry)
        if (data.byteLength > MAX_ZIP_IMAGE_BYTES) {
          sections.push(`Image "${entry.name}": [image exceeds the ${MAX_ZIP_IMAGE_BYTES}-byte limit].`)
          continue
        }
        const imagePath = path.join(tempDir, `${index}${ext}`) as FilePath
        await fs.writeFile(imagePath, data)
        const text = (
          await application.get('FileProcessingService').ocrImage({ kind: 'path', path: imagePath }, signal)
        ).trim()
        sections.push(`Image "${entry.name}":\n${text || noExtractableTextNote(entry.name)}`)
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        logger.warn('Failed to OCR image from ZIP attachment', error as Error, { entryId, entryName: entry.name })
        sections.push(`Image "${entry.name}": [could not read this image].`)
      }
    }

    const ignoredFiles = files.length - imageEntries.length
    if (ignoredFiles > 0) sections.push(`[Ignored ${ignoredFiles} non-image file(s) in the ZIP archive.]`)
    if (imageEntries.length > MAX_ZIP_IMAGES) {
      sections.push(
        `[Skipped ${imageEntries.length - MAX_ZIP_IMAGES} image(s) beyond the ${MAX_ZIP_IMAGES}-image limit.]`
      )
    }
    return sections.join('\n\n')
  } finally {
    try {
      await zip.close()
    } catch (error) {
      logger.warn('Failed to close ZIP attachment', error as Error, { entryId })
    }
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (error) {
        logger.warn('Failed to remove ZIP attachment temp directory', error as Error, { entryId })
      }
    }
  }
}

/**
 * OCR supported images in a ZIP attachment and return one text block. The ZIP
 * is bounded before extraction, individual images are materialized only in the
 * app temp directory, and the combined result is cached by file version.
 */
export async function extractZipImageText(entryId: FileEntryId, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const fileManager = application.get('FileManager')
  const cache = application.get('CacheService')
  const version = await fileManager.getVersion(entryId)
  const cacheKey = `zip-image-ocr:${entryId}:${version.mtime}:${version.size}`
  const cached = cache.get<string>(cacheKey)
  if (cached !== undefined) return cached

  throwIfAborted(opts.signal)
  const text = await extractZipImages(entryId, opts.signal)
  logger.debug('Processed ZIP image text', { entryId, chars: text.length })
  cache.set(cacheKey, text, CACHE_TTL_MS)
  return text
}
