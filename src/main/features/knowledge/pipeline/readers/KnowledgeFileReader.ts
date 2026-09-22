import { open } from 'node:fs/promises'

import { Document, FileReader as VectorStoreFileReader } from '@vectorstores/core'

import { getFileExt } from '@main/utils/legacyFile'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'

import { toMaterialRelativePath } from '../../items'
import { getKnowledgeBaseFilePath } from '../../pathStorage'
import { BINARY_SNIFF_BYTES, bytesLookBinary } from './binaryText'
import { AnydocReader } from './files/AnydocReader'
import { DraftsExportReader } from './files/DraftsExportReader'

/** Read only the leading {@link BINARY_SNIFF_BYTES} of a file and test them for the binary signal. */
async function filePrefixLooksBinary(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(BINARY_SNIFF_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0)
    return bytesLookBinary(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

const BINARY_CONTENT_ERROR =
  'This file decoded as binary content, not text, so it cannot be indexed. Only text-based files can be added to a knowledge base.'

class LazyFileReader extends VectorStoreFileReader<Document> {
  private readerPromise: Promise<VectorStoreFileReader<Document>> | undefined

  constructor(private readonly loadReader: () => Promise<VectorStoreFileReader<Document>>) {
    super()
  }

  override async loadData(filePath: string): Promise<Document[]> {
    const reader = await (this.readerPromise ??= this.loadReader())
    return reader.loadData(filePath)
  }

  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document[]> {
    const reader = await (this.readerPromise ??= this.loadReader())
    return reader.loadDataAsContent(fileContent, filename)
  }
}

// Marker subclass for the factory's `default` (text-fallback) branch, so `usesTextFallbackReader`
// can ask the factory instead of mirroring its extension list.
class TextFallbackReader extends LazyFileReader {}

export function createSupportedFileReader(filePath: AbsoluteFilePath): VectorStoreFileReader<Document> {
  return createReaderForExtension(getFileExt(filePath).toLowerCase())
}

function createReaderForExtension(extension: string): VectorStoreFileReader<Document> {
  switch (extension) {
    case '.pdf':
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/pdf').then(({ PDFReader }) => new PDFReader())
      )
    case '.csv':
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/csv').then(({ CSVReader }) => new CSVReader())
      )
    case '.doc':
      return new AnydocReader(async () => {
        const { DocReader } = await import('./files/DocReader')
        return new DocReader()
      })
    case '.docx':
      return new AnydocReader(async () => {
        const { DocxReader } = await import('@vectorstores/readers/docx')
        return new DocxReader()
      })
    case '.epub':
      return new AnydocReader(async () => {
        const { EpubReader } = await import('./files/EpubReader')
        return new EpubReader()
      }, true)
    case '.ppt':
    case '.pptx':
    case '.xls':
    case '.xlsx':
      return new AnydocReader()
    case '.html':
    case '.htm':
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/html').then(({ HTMLReader }) => new HTMLReader())
      )
    case '.json':
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/json').then(({ JSONReader }) => new JSONReader())
      )
    case '.markdown':
    case '.md':
    case '.mdx':
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/markdown').then(({ MarkdownReader }) => new MarkdownReader())
      )
    case '.draftsexport':
      return new DraftsExportReader()
    default:
      // The text fallback decodes bytes non-fatally, so it is the only path where a binary file
      // becomes mojibake instead of failing — hence the only path the binary guard runs on.
      return new TextFallbackReader(async () =>
        import('@vectorstores/readers/text').then(({ TextFileReader }) => new TextFileReader())
      )
  }
}

/** True when the factory routes {@link filePath} to the non-fatal text fallback, the only reader
 * that can turn a binary file into mojibake. Derived from the factory itself — no parallel list. */
export const usesTextFallbackReader = (filePath: string): boolean =>
  createReaderForExtension(getFileExt(filePath).toLowerCase()) instanceof TextFallbackReader

/**
 * True when a file read through the non-fatal text fallback would decode as binary (dedicated readers
 * own their container format, so they are exempt). Runs on the ORIGINAL source before it is copied
 * into the base, so large binary media (e.g. an `.ts` transport stream on a directory embed) is caught
 * before a wasted copy.
 */
export async function sourceFileLooksBinary(filePath: string): Promise<boolean> {
  return usesTextFallbackReader(filePath) && (await filePrefixLooksBinary(filePath))
}

/** Throwing form of {@link sourceFileLooksBinary} for explicit-pick paths that must fail visibly. */
export async function assertSourceFileNotBinary(filePath: string): Promise<void> {
  if (await sourceFileLooksBinary(filePath)) {
    throw new Error(BINARY_CONTENT_ERROR)
  }
}

/**
 * Read a base-relative file with the extension's reader and tag every document
 * with `source`.
 */
export async function loadDocumentsFromKnowledgeBaseFile(
  baseId: string,
  relativePath: string,
  source: string
): Promise<Document[]> {
  const filePath = getKnowledgeBaseFilePath(baseId, relativePath)

  const reader = createSupportedFileReader(filePath)
  const documents = await reader.loadData(filePath)

  const sourceMetadata: KnowledgeSourceMetadata = { source }

  return documents.map(
    (document) =>
      new Document({
        text: document.text,
        metadata: { ...sourceMetadata }
      })
  )
}

export async function loadFileDocuments(item: KnowledgeItemOf<'file'>): Promise<Document[]> {
  return loadDocumentsFromKnowledgeBaseFile(item.baseId, toMaterialRelativePath(item), item.data.source)
}
