import type { toMarkdownBytes } from '@firecrawl/anydoc'
import { loggerService } from '@logger'
import { Document, FileReader, type Metadata } from '@vectorstores/core'

const logger = loggerService.withContext('KnowledgeAnydocReader')
type AnydocModule = { toMarkdownBytes: typeof toMarkdownBytes }

let anydocModulePromise: Promise<AnydocModule> | undefined
let didLogModuleLoadFailure = false

function loadAnydocModule(): Promise<AnydocModule> {
  return (anydocModulePromise ??= import('@firecrawl/anydoc'))
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Reader for binary office documents and EPUB books, backed by `@firecrawl/anydoc`.
 *
 * It converts the whole document to Markdown, so headings, lists and tables
 * survive into the index instead of being flattened to a text blob. The format
 * is detected from the content signature — every format routed here (OLE2,
 * OOXML zip, and EPUB OCF zip containers) carries one, so no explicit format
 * is needed.
 *
 * anydoc ships no `win32-arm64` binary and no wasm fallback, so the native
 * module fails to load there. Formats can supply `createFallback` to remain
 * readable when the native module is unavailable.
 */
export class AnydocReader extends FileReader<Document<Metadata>> {
  constructor(
    private readonly createFallback?: () => FileReader<Document<Metadata>>,
    private readonly fallbackOnEmpty = false
  ) {
    super()
  }

  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document<Metadata>[]> {
    let anydoc: AnydocModule
    try {
      anydoc = await loadAnydocModule()
    } catch (error) {
      const normalizedError = normalizeError(error)
      if (!didLogModuleLoadFailure) {
        didLogModuleLoadFailure = true
        logger.error('Failed to load the anydoc native module', normalizedError)
      }
      if (!this.createFallback) {
        throw normalizedError
      }
      return this.createFallback().loadDataAsContent(fileContent, filename)
    }

    let markdown: string
    try {
      markdown = (await anydoc.toMarkdownBytes(fileContent)).trim()
    } catch (error) {
      const normalizedError = normalizeError(error)
      if (!this.createFallback) {
        logger.warn('anydoc conversion failed', normalizedError, { filename })
        throw normalizedError
      }
      logger.warn('anydoc conversion failed, falling back to the legacy reader', normalizedError, { filename })
      return this.createFallback().loadDataAsContent(fileContent, filename)
    }

    if (markdown) {
      return [new Document({ text: markdown })]
    }
    if (this.fallbackOnEmpty && this.createFallback) {
      logger.warn('anydoc conversion produced no text, falling back to the legacy reader', { filename })
      return this.createFallback().loadDataAsContent(fileContent, filename)
    }
    if (!this.createFallback) {
      const error = new Error('anydoc conversion produced no text')
      logger.warn('anydoc conversion failed', error, { filename })
      throw error
    }
    return []
  }
}
