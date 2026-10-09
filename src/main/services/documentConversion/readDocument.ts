import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Block, Document, Inline } from '@firecrawl/anydoc'

import { createPdfParser } from '@main/utils/pdf'
import { exportErrorCodes } from '@shared/ipc/errors/export'
import { getDocumentSourceFormat, DOCUMENT_MARKDOWN_MAX_BYTES } from '@shared/types/documentConversion'
import type { DocumentBlock, DocumentCell, DocumentModel, DocumentTextRun } from '@shared/types/documentModel'

import { DocumentConversionError } from './DocumentConversionError'
import { prepareStaticHtml, renderStaticHtml } from './html'
import { parseMarkdown } from './parseMarkdown'

export interface DocumentSource {
  markdown?: string
  filePath?: string
  sourcePath?: string
  sourceBytes?: Uint8Array
  sourceName?: string
  draft?: string
  assetRoot?: string
  relaxedTables?: boolean
}

export interface ReadDocumentResult extends DocumentModel {
  images: Map<string, Buffer>
  html?: string
  markdown?: string
}

const MAX_SOURCE_BYTES = 50 * 1024 * 1024

export async function readDocument(input: DocumentSource, signal?: AbortSignal): Promise<ReadDocumentResult> {
  signal?.throwIfAborted()
  if ((input.markdown !== undefined) === (input.filePath !== undefined)) {
    throw new Error('Provide exactly one of Markdown content or a source file')
  }
  if (input.markdown !== undefined) {
    assertTextSize(input.markdown)
    return {
      blocks: parseMarkdown(input.markdown, !input.relaxedTables),
      images: new Map(),
      warnings: [],
      markdown: input.markdown
    }
  }
  const sourcePath = input.filePath!
  const format = getDocumentSourceFormat(input.sourceName ?? sourcePath)
  if (!format) throw new Error('Unsupported source document format')
  if (input.draft !== undefined && format !== 'md' && format !== 'html')
    throw new Error('Only text documents have drafts')
  if (!input.sourceBytes && input.draft === undefined) {
    const info = await stat(sourcePath)
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error('Source must be a regular file under 50 MiB')
  }
  const bytes =
    input.draft !== undefined
      ? Buffer.from(input.draft)
      : (input.sourceBytes ?? (await readFile(sourcePath, { signal })))
  if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('Source document exceeds 50 MiB')
  signal?.throwIfAborted()
  if (format === 'md' || format === 'html') {
    const text = Buffer.from(bytes).toString('utf8')
    if (format === 'md') {
      assertTextSize(text)
      return { blocks: parseMarkdown(text), images: new Map(), warnings: [], markdown: text }
    }
    const prepared = await prepareStaticHtml(text, { ...input, sourcePath }, signal)
    const model = await renderStaticHtml(prepared.html, false, signal)
    return { ...model, warnings: [...prepared.warnings, ...model.warnings], html: prepared.html, images: new Map() }
  }
  const anydoc = await import('@firecrawl/anydoc')
  if (format === 'pdf') {
    const parser = await createPdfParser({ data: bytes })
    try {
      const { pages } = await parser.getText()
      const emptyPages = pages.filter((page) => !page.text.trim()).map((page) => page.num)
      const images = emptyPages.length
        ? await parser.getImage({ partial: emptyPages, imageBuffer: false, imageDataUrl: false, imageThreshold: 0 })
        : undefined
      if (images?.pages.some((page) => page.images.length > 0)) {
        throw new DocumentConversionError(
          exportErrorCodes.PDF_OCR_REQUIRED,
          'This PDF contains scanned pages. Run OCR before converting it.',
          ''
        )
      }
      const text = pages
        .map((page) => page.text.trim())
        .filter(Boolean)
        .join('\n\n')
      assertTextSize(text)
      let markdown: string
      try {
        markdown = await anydoc.toMarkdownBytes(bytes, anydoc.formatFromExtension('pdf'))
      } catch (error) {
        if (!emptyPages.length) throw error
        markdown = text
      }
      assertTextSize(markdown)
      // anydoc emits PDF emphasis as HTML. Do not keep that string for a later print.
      return {
        blocks: parseMarkdown(markdown, true, { interpretSafeHtml: true }),
        images: new Map(),
        warnings: ['pdf_text_only']
      }
    } finally {
      await parser.destroy()
    }
  }
  const document = await anydoc
    .toDocument(bytes, anydoc.formatFromExtension(path.extname(input.sourceName ?? sourcePath)))
    .catch((error: unknown) => {
      throw new DocumentConversionError(
        exportErrorCodes.INVALID_SOURCE,
        error instanceof Error ? error.message : String(error),
        sourcePath
      )
    })
  const images = new Map<string, Buffer>()
  const warnings = new Set<string>()
  const blocks = officeBlocks(document.blocks, document, images, warnings)
  return { blocks, images, warnings: [...warnings] }
}

function assertTextSize(text: string): void {
  if (!text.trim()) throw new DocumentConversionError(exportErrorCodes.EMPTY_DOCUMENT, 'Document is empty', '')
  if (Buffer.byteLength(text) > DOCUMENT_MARKDOWN_MAX_BYTES)
    throw new DocumentConversionError(exportErrorCodes.DOCUMENT_TOO_LARGE, 'Document text exceeds 2 MiB', '')
}

function officeRuns(inlines: Inline[]): DocumentTextRun[] {
  return inlines.flatMap((inline): DocumentTextRun[] => {
    if (inline.kind === 'link')
      return officeRuns(inline.content ?? []).map((run) => ({ ...run, link: inline.target?.value }))
    if (inline.kind === 'lineBreak') return [{ text: '\n' }]
    if (inline.kind !== 'text') return []
    return [
      {
        text: inline.text ?? '',
        bold: inline.style?.bold,
        italic: inline.style?.italic,
        strike: inline.style?.strike,
        ...(inline.style?.code ? { font: 'Consolas' } : {})
      }
    ]
  })
}

function officeBlocks(
  blocks: Block[],
  document: Document,
  images: Map<string, Buffer>,
  warnings: Set<string>,
  depth = 0
): DocumentBlock[] {
  const result: DocumentBlock[] = []
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading') {
      let pending: Inline[] = []
      const flush = () => {
        const runs = officeRuns(pending)
        const text = runs.map((run) => run.text).join('')
        if (text.trim())
          result.push(
            block.kind === 'heading'
              ? { type: 'heading', level: block.level ?? 1, text, runs }
              : { type: 'text', text, runs, ...(depth ? { bullet: depth } : {}) }
          )
        pending = []
      }
      for (const inline of block.content ?? []) {
        if (inline.kind !== 'image') {
          pending.push(inline)
          continue
        }
        flush()
        const source = inline.source
        if (source?.kind === 'asset' && source.assetId !== undefined) {
          const asset = document.assets.find((candidate) => candidate.id === source.assetId)
          if (asset?.mediaType.startsWith('image/')) {
            const name = `embedded:${asset.id}`
            images.set(name, Buffer.from(asset.data))
            result.push({ type: 'image', source: name, text: inline.alt ?? '' })
          } else warnings.add('unsupported_image')
        } else if (source?.kind === 'external' && source.url) {
          result.push({ type: 'image', source: source.url, text: inline.alt ?? '' })
        } else warnings.add('unsupported_image')
      }
      flush()
    } else if (block.kind === 'list') {
      let number = block.list?.start ?? 1
      for (const item of block.list?.items ?? []) {
        const children = officeBlocks(item.blocks, document, images, warnings, depth + 1)
        if (block.list?.marker !== 'bullet') {
          const first = children.find((child) => child.type === 'text')
          if (first?.type === 'text') first.orderedNumber = number++
          if (block.list?.marker !== 'decimal') warnings.add('complex_layout')
        }
        result.push(...children)
      }
    } else if (block.kind === 'table' && block.table) {
      const cells = block.table.grid.map((row) =>
        row.map((slot): DocumentCell => {
          if (slot.kind === 'covered') return { runs: [], covered: true }
          const content = officeBlocks(slot.cell?.blocks ?? [], document, images, warnings)
          const runs = content.flatMap((child): DocumentTextRun[] =>
            'text' in child && child.type !== 'image' ? [...(child.runs ?? [{ text: child.text }]), { text: '\n' }] : []
          )
          for (const child of content) if (child.type === 'image') result.push(child)
          return { runs, rowSpan: slot.cell?.rowSpan, colSpan: slot.cell?.colSpan }
        })
      )
      const title = [...result].reverse().find((item) => item.type === 'heading')
      result.push({
        type: 'table',
        title: title?.type === 'heading' ? title.text : '',
        cells,
        rows: cells.map((row) =>
          row.map((cell) =>
            cell.runs
              .map((run) => run.text)
              .join('')
              .trim()
          )
        )
      })
    } else if (block.kind === 'blockQuote')
      result.push(...officeBlocks(block.blocks ?? [], document, images, warnings, depth))
    else if (block.kind === 'codeBlock') result.push({ type: 'code', text: block.text ?? '' })
  }
  return result
}
