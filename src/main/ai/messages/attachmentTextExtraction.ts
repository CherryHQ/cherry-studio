/**
 * Document → plain text extraction for the AI `read_file` tool.
 *
 * Single home for "turn a non-image, non-natively-consumable file into text":
 *   - `pdf`                          → `extractPdfText` (`@main/utils/pdf`)
 *   - `doc`                          → `word-extractor`
 *   - `docx/pptx/xlsx/od*`           → `officeparser`
 *   - everything else (text / code)  → encoding-detected decode
 *
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { decodeTextWithAutoEncoding } from '@main/utils/file'
import { extractPdfText } from '@main/utils/pdf'
import type { FileEntryId } from '@shared/data/types/file'
import { documentExts } from '@shared/utils/file'
import { OfficeConverter, type SupportedFileType } from 'officeparser'
import WordExtractor from 'word-extractor'

const logger = loggerService.withContext('ai:documentExtraction')

const OFFICE_PARSER_EXTS = new Set<SupportedFileType>(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])

const CACHE_TTL_MS = 30 * 60 * 1000

/** Model-facing note when a document yields no extractable text (scanned / image-only). */
export function noExtractableTextNote(filename: string): string {
  return `No extractable text found in "${filename}" — it may be a scanned or image-only document.`
}

async function extract(entryId: FileEntryId, ext: string): Promise<string> {
  const { content } = await application.get('FileManager').read(entryId, { encoding: 'binary' })

  if (ext === 'pdf') return (await extractPdfText(content)).trim()

  const buffer = Buffer.from(content)
  if (ext === 'doc') {
    const extracted = await new WordExtractor().extract(buffer)
    return extracted.getBody().trim()
  }
  if (OFFICE_PARSER_EXTS.has(ext as SupportedFileType)) {
    const result = await OfficeConverter.convert(buffer, 'text', {
      parseConfig: {
        fileType: ext as SupportedFileType
      },
      generatorConfig: {
        textConfig: {
          newlineDelimiter: '\n',
          preserveLayout: true
        }
      }
    })
    return String(result.value).trim()
  }
  if (documentExts.includes(`.${ext}`)) return ''
  return decodeTextWithAutoEncoding(buffer).trim()
}

/**
 * Extract plain text from a file entry (may be empty for scanned/image-only
 * docs — the caller emits {@link noExtractableTextNote}). Throws on unreadable
 * file / parse failure, and rethrows the abort reason if `signal` is aborted.
 */
export async function extractDocumentText(entryId: FileEntryId, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const fileManager = application.get('FileManager')
  const cache = application.get('CacheService')

  const version = await fileManager.getVersion(entryId)
  const cacheKey = `doc-extraction:${entryId}:${version.mtime}:${version.size}`
  const cached = cache.get<string>(cacheKey)
  if (cached !== undefined) return cached

  if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('Aborted')
  const entry = await fileManager.getById(entryId)
  const ext = entry.ext?.toLowerCase() ?? ''
  const text = await extract(entryId, ext)

  logger.debug('Extracted document text', { entryId, ext, chars: text.length })
  cache.set(cacheKey, text, CACHE_TTL_MS)
  return text
}
