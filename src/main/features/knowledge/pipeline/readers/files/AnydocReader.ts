import { loggerService } from '@logger'
import { Document, FileReader, type Metadata } from '@vectorstores/core'

const logger = loggerService.withContext('KnowledgeAnydocReader')

/**
 * Reader for binary office documents, backed by `@firecrawl/anydoc`.
 *
 * It converts the whole document to Markdown, so headings, lists and tables
 * survive into the index instead of being flattened to a text blob. The format
 * is detected from the content signature — every format routed here (OLE2 and
 * OOXML/ODF zip containers) carries one, so no explicit format is needed.
 *
 * anydoc ships no `win32-arm64` binary and no wasm fallback, so the native
 * module fails to load there. `createFallback` keeps those platforms — and any
 * document anydoc chokes on — on the reader they used before.
 */
export class AnydocReader extends FileReader<Document<Metadata>> {
  constructor(private readonly createFallback: () => FileReader<Document<Metadata>>) {
    super()
  }

  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    let markdown: string
    try {
      const { toMarkdownBytes } = await import('@firecrawl/anydoc')
      markdown = (await toMarkdownBytes(fileContent)).trim()
    } catch (error) {
      logger.warn('anydoc conversion failed, falling back to the legacy reader', error as Error, { filename })
      return this.createFallback().loadDataAsContent(fileContent, filename)
    }

    return markdown ? [new Document({ text: markdown })] : []
  }
}
