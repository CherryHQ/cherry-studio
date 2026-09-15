/**
 * Document → plain text extraction for the AI `read_file` tool.
 *
 * Single home for "turn a non-image, non-natively-consumable file into text":
 *   - `pdf`                          → `extractPdfText` (`@main/utils/pdf`)
 *   - `doc`                          → `word-extractor`
 *   - `docx/pptx/xlsx/xls/od*`       → `officeparser`
 *   - everything else (text / code)  → encoding-aware text detection for
 *                                       extensionless files, then decode
 *
 */

import { createHash } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import { decodeTextBufferIfText } from '@main/utils/file'
import { decodeTextWithAutoEncoding } from '@main/utils/legacyFile'
import { extractPdfText } from '@main/utils/pdf'
import type { FileEntryId } from '@shared/data/types/file'
import { documentExts } from '@shared/utils/file'

const logger = loggerService.withContext('ai:documentExtraction')

/** Bare extensions officeparser handles — `documentExts` minus PDF (own parser) and `doc` (word-extractor). */
const OFFICE_PARSER_EXTS = new Set(
  documentExts.map((ext) => ext.replace(/^\./, '')).filter((ext) => ext !== 'pdf' && ext !== 'doc')
)

const CACHE_TTL_MS = 30 * 60 * 1000

/** Model-facing note when a document yields no extractable text (scanned / image-only). */
export function noExtractableTextNote(filename: string): string {
  return `No extractable text found in "${filename}" — it may be a scanned or image-only document.`
}

async function extract(entryId: FileEntryId, ext: string, preparedBytes?: Buffer): Promise<string | null> {
  const content = preparedBytes ?? (await application.get('FileManager').read(entryId, { encoding: 'binary' })).content

  if (ext === 'pdf') return (await extractPdfText(content)).trim()

  const buffer = Buffer.from(content)
  if (ext === 'doc') {
    const { default: WordExtractor } = await import('word-extractor')
    const extracted = await new WordExtractor().extract(buffer)
    return extracted.getBody().trim()
  }
  if (OFFICE_PARSER_EXTS.has(ext)) {
    // Delayed loading: officeparser (and the pdf stack it drags in) stays out of the boot path.
    const { default: officeParser } = await import('officeparser')
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
  opts: { signal?: AbortSignal; preparedBytes?: Buffer; preparedExt?: string } = {}
): Promise<string | null> {
  const fileManager = application.get('FileManager')
  const cache = application.get('CacheService')

  const version = opts.preparedBytes ? null : await fileManager.getVersion(entryId)
  const cacheKey = opts.preparedBytes
    ? `doc-extraction:content:${opts.preparedExt ?? ''}:${createHash('sha256').update(opts.preparedBytes).digest('hex')}`
    : `doc-extraction:${entryId}:${version!.mtime}:${version!.size}`
  const cached = cache.get<string | null>(cacheKey)
  if (cached !== undefined) return cached

  if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('Aborted')
  const ext = opts.preparedExt ?? (await fileManager.getById(entryId)).ext?.toLowerCase() ?? ''
  const text = await extract(entryId, ext, opts.preparedBytes)

  logger.debug('Processed document text', { entryId, ext, chars: text?.length ?? 0, binary: text === null })
  cache.set(cacheKey, text, CACHE_TTL_MS)
  return text
}
