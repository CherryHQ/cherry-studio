import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { application } from '@application'
import * as XLSX from '@e965/xlsx'
import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import { exportService } from '@main/services/ExportService'
import { printService } from '@main/services/PrintService'
import { atomicWriteFile, exists, publishFileNoClobber, readBoundedRegularFile, remove } from '@main/utils/file'
import type { ExportOfficeInput, OfficeExportOperation } from '@shared/ai/builtinTools'
import type { FilePath } from '@shared/types/file'
import MarkdownIt from 'markdown-it'
import PptxGenJS from 'pptxgenjs'

import { renderCherryPptx } from './cherryPpt'

interface SlideDraft {
  title: string
  body: Array<{ text: string; bullet: boolean }>
}

const markdownIt = new MarkdownIt({ html: false, linkify: true, typographer: false })
const logger = loggerService.withContext('ExportOffice')
const MAX_OFFICE_SOURCE_BYTES = 10 * 1024 * 1024

const OPERATION_EXTENSIONS: Record<OfficeExportOperation, { source: readonly string[]; output: string }> = {
  markdown_to_docx: { source: ['.md', '.markdown'], output: '.docx' },
  markdown_to_pdf: { source: ['.md', '.markdown'], output: '.pdf' },
  markdown_to_pptx: { source: ['.md', '.markdown'], output: '.pptx' },
  cherry_ppt_to_pptx: { source: ['.json'], output: '.pptx' },
  csv_to_xlsx: { source: ['.csv'], output: '.xlsx' }
}

function inlineText(token: ReturnType<MarkdownIt['parse']>[number]): string {
  if (!token.children) return token.content
  return token.children
    .map((child) => {
      if (child.type === 'softbreak' || child.type === 'hardbreak') return '\n'
      return child.type === 'text' || child.type === 'code_inline' || child.type === 'image' ? child.content : ''
    })
    .join('')
}

function assertExtension(filePath: string, allowedExtensions: readonly string[], kind: 'source' | 'output'): void {
  const actual = path.extname(filePath).toLowerCase()
  if (allowedExtensions.includes(actual)) return

  const expected = allowedExtensions.join(' or ')
  throw new Error(`Office export ${kind} must use ${expected}; received ${actual || 'no extension'}`)
}

function firstMarkdownHeading(markdown: string, fallback: string): string {
  const tokens = markdownIt.parse(markdown, {})
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].type !== 'heading_open') continue
    const inline = tokens[index + 1]
    const title = inline ? inlineText(inline).trim() : ''
    if (title) return title
  }
  return fallback
}

function parseSlides(markdown: string, fallbackTitle: string): SlideDraft[] {
  const tokens = markdownIt.parse(markdown, {})
  const slides: SlideDraft[] = []
  let current: SlideDraft = { title: '', body: [] }
  let listDepth = 0

  const flush = () => {
    if (!current.title && current.body.length === 0) return
    slides.push({
      title: current.title || (slides.length === 0 ? fallbackTitle : `${fallbackTitle} (${slides.length + 1})`),
      body: current.body
    })
    current = { title: '', body: [] }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    switch (token.type) {
      case 'hr':
        flush()
        break
      case 'bullet_list_open':
      case 'ordered_list_open':
        listDepth += 1
        break
      case 'bullet_list_close':
      case 'ordered_list_close':
        listDepth = Math.max(0, listDepth - 1)
        break
      case 'heading_open': {
        const level = Number(token.tag.slice(1))
        const inline = tokens[index + 1]
        const heading = inline ? inlineText(inline).trim() : ''
        if (!heading) break
        if (level <= 2) {
          flush()
          current.title = heading
        } else {
          current.body.push({ text: heading, bullet: false })
        }
        index += 2
        break
      }
      case 'paragraph_open': {
        const inline = tokens[index + 1]
        const text = inline ? inlineText(inline).trim() : ''
        if (text) current.body.push({ text, bullet: listDepth > 0 })
        index += 2
        break
      }
      case 'fence':
      case 'code_block': {
        const text = token.content.trim()
        if (text) current.body.push({ text, bullet: false })
        break
      }
    }
  }

  flush()
  return slides.length > 0 ? slides : [{ title: fallbackTitle, body: [] }]
}

async function renderMarkdownToPptx(markdown: string, fallbackTitle: string): Promise<Uint8Array> {
  const presentation = new PptxGenJS()
  const slides = parseSlides(markdown, fallbackTitle)

  presentation.layout = 'LAYOUT_WIDE'
  presentation.author = 'Cherry Studio'
  presentation.company = 'Cherry Studio'
  presentation.subject = fallbackTitle
  presentation.title = slides[0].title
  presentation.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' }

  for (const [index, draft] of slides.entries()) {
    const slide = presentation.addSlide()
    const isCover = index === 0
    slide.background = { color: isCover ? 'F7F8FA' : 'FFFFFF' }

    slide.addShape(presentation.ShapeType.rect, {
      x: 0,
      y: 0,
      w: isCover ? 0.18 : 13.333,
      h: isCover ? 7.5 : 0.08,
      line: { color: 'C53D32', transparency: 100 },
      fill: { color: 'C53D32' }
    })
    slide.addText(draft.title, {
      x: isCover ? 1.05 : 0.72,
      y: isCover ? 2.15 : 0.45,
      w: isCover ? 11.1 : 11.85,
      h: isCover ? 1.35 : 0.72,
      margin: 0,
      bold: true,
      color: '20252B',
      fontFace: 'Aptos Display',
      fontSize: isCover ? 30 : 25,
      fit: 'shrink',
      valign: 'middle'
    })

    if (draft.body.length > 0) {
      const bodyText = draft.body.map(({ text, bullet }) => `${bullet ? '• ' : ''}${text}`).join('\n\n')
      const bodyCharacters = bodyText.length
      const fontSize = bodyCharacters > 700 ? 16 : bodyCharacters > 400 ? 19 : isCover ? 19 : 22
      slide.addText(bodyText, {
        x: isCover ? 1.08 : 0.78,
        y: isCover ? 3.7 : 1.5,
        w: isCover ? 10.9 : 11.72,
        h: isCover ? 1.35 : 5.15,
        margin: 0,
        color: '454B53',
        fontFace: 'Aptos',
        fontSize,
        fit: 'shrink',
        valign: 'top',
        lineSpacingMultiple: 1.15,
        paraSpaceAfter: 12
      })
    }

    slide.addText(String(index + 1), {
      x: 12.35,
      y: 7.05,
      w: 0.45,
      h: 0.2,
      margin: 0,
      align: 'right',
      color: '8A9199',
      fontFace: 'Aptos',
      fontSize: 9
    })
  }

  const output = await presentation.write({ outputType: 'uint8array', compression: true })
  if (!(output instanceof Uint8Array)) {
    throw new Error('PPTX renderer returned an unsupported output type')
  }
  return output
}

function renderCsvToXlsx(csv: string): Uint8Array {
  const workbook = XLSX.read(csv, { type: 'string', raw: true })
  const sheetName = workbook.SheetNames[0]
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!worksheet) throw new Error('CSV source does not contain a worksheet')

  const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, { header: 1, raw: true })
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  worksheet['!cols'] = Array.from({ length: columnCount }, (_, columnIndex) => {
    const width = Math.max(10, ...rows.map((row) => String(row[columnIndex] ?? '').length + 2))
    return { wch: Math.min(width, 50) }
  })

  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
}

function relativeWorkspacePath(workspacePath: string, outputPath: string): string {
  return path.relative(workspacePath, outputPath).split(path.sep).join('/')
}

function pathsEqual(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

async function assertWorkspacePathUnchanged(
  requestedPath: string,
  expectedPath: string,
  workspacePath: string,
  kind: 'source' | 'output'
): Promise<void> {
  const currentPath = await validatePath(requestedPath, workspacePath)
  if (!pathsEqual(currentPath, expectedPath)) {
    throw new Error(`Office export ${kind} path changed during export: ${requestedPath}`)
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

async function removeStagingBestEffort(stagingPath: FilePath): Promise<void> {
  try {
    await remove(stagingPath)
  } catch (error) {
    logger.warn('Failed to clean up Office export staging file', {
      stagingPath,
      code: (error as NodeJS.ErrnoException).code,
      error
    })
  }
}

export async function exportOfficeArtifact(
  workspacePath: string,
  input: ExportOfficeInput,
  signal: AbortSignal
): Promise<{ path: string }> {
  signal.throwIfAborted()

  const extensions = OPERATION_EXTENSIONS[input.operation]
  assertExtension(input.source_path, extensions.source, 'source')
  assertExtension(input.output_path, [extensions.output], 'output')

  const [resolvedWorkspacePath, resolvedSourcePath, resolvedOutputPath] = await Promise.all([
    validatePath('.', workspacePath),
    validatePath(input.source_path, workspacePath),
    validatePath(input.output_path, workspacePath)
  ])
  const sourcePath = resolvedSourcePath as FilePath
  const outputPath = resolvedOutputPath as FilePath

  let source: string
  try {
    source = await readBoundedRegularFile(sourcePath, { maxBytes: MAX_OFFICE_SOURCE_BYTES, signal })
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`Office export source not found in workspace: ${input.source_path}`)
    }
    throw error
  }
  if (source.includes('\0')) {
    throw new Error(`Office export source must be UTF-8 text without NUL bytes: ${input.source_path}`)
  }
  await assertWorkspacePathUnchanged(input.source_path, sourcePath, resolvedWorkspacePath, 'source')

  signal.throwIfAborted()
  await assertWorkspacePathUnchanged(input.output_path, outputPath, resolvedWorkspacePath, 'output')
  if (await exists(outputPath)) throw new Error(`Office export output already exists: ${input.output_path}`)

  const fallbackTitle = path.basename(sourcePath, path.extname(sourcePath)) || 'Presentation'
  const stagingPath = path.join(
    resolvedWorkspacePath,
    `.cherry-office-export-${randomUUID()}${extensions.output}`
  ) as FilePath

  try {
    switch (input.operation) {
      case 'markdown_to_docx':
        await exportService.exportToWordPath(source, stagingPath, signal)
        break
      case 'markdown_to_pdf':
        await printService.exportToPdfPath(
          { title: firstMarkdownHeading(source, fallbackTitle), markdown: source, sourcePath },
          stagingPath,
          { signal, allowImages: false }
        )
        break
      case 'markdown_to_pptx': {
        const data = await renderMarkdownToPptx(source, fallbackTitle)
        await atomicWriteFile(stagingPath, data, { signal })
        break
      }
      case 'cherry_ppt_to_pptx': {
        const templateDirectory = application.getPath('feature.agents.assistant.cherry_ppt.templates')
        const data = await renderCherryPptx(source, templateDirectory, signal)
        await atomicWriteFile(stagingPath, data, { signal })
        break
      }
      case 'csv_to_xlsx': {
        const data = renderCsvToXlsx(source)
        await atomicWriteFile(stagingPath, data, { signal })
        break
      }
    }

    signal.throwIfAborted()
    await assertWorkspacePathUnchanged(input.output_path, outputPath, resolvedWorkspacePath, 'output')
    try {
      await publishFileNoClobber(stagingPath, outputPath, {
        signal,
        validateTarget: () =>
          assertWorkspacePathUnchanged(input.output_path, outputPath, resolvedWorkspacePath, 'output')
      })
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        throw new Error(`Office export output already exists: ${input.output_path}`)
      }
      throw error
    }
  } finally {
    await removeStagingBestEffort(stagingPath)
  }

  return { path: relativeWorkspacePath(resolvedWorkspacePath, outputPath) }
}
