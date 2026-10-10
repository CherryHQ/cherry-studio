import { Document, FileReader as VectorStoreFileReader } from '@vectorstores/core'

import { getFileExt } from '@main/utils/legacyFile'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import type { AbsoluteFilePath } from '@shared/types/file'

import { toMaterialRelativePath } from '../../items'
import { getKnowledgeBaseFilePath } from '../../pathStorage'
import { AnydocReader } from './files/AnydocReader'
import { DraftsExportReader } from './files/DraftsExportReader'

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

export function createSupportedFileReader(filePath: AbsoluteFilePath): VectorStoreFileReader<Document> {
  const extension = getFileExt(filePath).toLowerCase()

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
      return new LazyFileReader(async () =>
        import('@vectorstores/readers/text').then(({ TextFileReader }) => new TextFileReader())
      )
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
