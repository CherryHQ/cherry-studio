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

import { application } from '@application'
import { loggerService } from '@logger'
import { decodeTextBufferIfText } from '@main/utils/file'
import { decodeTextWithAutoEncoding } from '@main/utils/legacyFile'
import { extractPdfText } from '@main/utils/pdf'
import type { FileEntryId } from '@shared/data/types/file'
import { documentExts } from '@shared/utils/file'
import officeParser from 'officeparser'
import WordExtractor from 'word-extractor'

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
