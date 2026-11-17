/* oxlint-disable no-case-declarations */
// ExportService

import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type * as Docx from 'docx'
import type { ExternalHyperlink, ImageRun, Table, TableCell, TableRow, TextRun } from 'docx'
import { type BrowserWindow, dialog } from 'electron'
import { fileTypeFromBuffer } from 'file-type'
import type MarkdownIt from 'markdown-it'

import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { transcodeToPng } from '@main/utils/image'
import { parseDataUrl } from '@shared/utils/dataUrl'

const logger = loggerService.withContext('ExportService')
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const docxImageTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' } as const
const isWindowsFileReference = (src: string) => /^(?:file:\/\/)?[a-z]:\\/i.test(src)
const isRecognizedLocalFileReference = (src: string) =>
  isWindowsFileReference(src) || src.startsWith('/') || (/^file:\/\//i.test(src) && URL.canParse(src))
const isImageDataUri = (src: string) => /^data:image\//i.test(src)

export class ExportService {
  private async convertMarkdownToDocxElements(
    markdown: string,
    md: MarkdownIt,
    docx: typeof Docx
  ): Promise<Array<Docx.Paragraph | Docx.Table>> {
    const {
      AlignmentType,
      BorderStyle,
      ExternalHyperlink,
      HeadingLevel,
      Paragraph,
      ShadingType,
      Table,
      TableCell,
      TableRow,
      TextRun,
      VerticalAlign,
      WidthType
    } = docx
    const tokens = md.parse(markdown, {})
    const elements: Array<Docx.Paragraph | Docx.Table> = []
    const listCounters: Array<number | null> = []
    let quoteLevel = 0
    const quoteBorder = { left: { style: BorderStyle.SINGLE, size: 3, color: 'CCCCCC' } }
    let currentTable: Table | null = null
    let currentRowCells: TableCell[] = []
    let isHeaderRow = false
    let tableColumnCount = 0
    let tableRows: TableRow[] = [] // Store rows temporarily

    const inlineText = (tokens: any[]): string =>
      tokens
        .map((token) => {
          switch (token.type) {
            case 'text':
            case 'code_inline':
              return token.content
            case 'softbreak':
            case 'hardbreak':
              return ' '
            case 'image':
              return inlineText(token.children)
            default:
              return ''
          }
        })
        .join('')

    const resolveImage = async (src: string): Promise<ImageRun | null> => {
      let bytes: Uint8Array
      if (isImageDataUri(src)) {
        const data = parseDataUrl(src.replace(/^data:/i, 'data:'))
        if (!data || data.mediaType?.toLowerCase() === 'image/svg+xml') return null
        if (data.isBase64) {
          const payload = decodeURIComponent(data.data)
          if (/[^a-z\d+/=\s]/i.test(payload)) return null
          bytes = Buffer.from(payload, 'base64')
        } else {
          if (/%(?![\da-f]{2})/i.test(data.data)) return null
          bytes = Buffer.from(
            data.data.replace(/%([\da-f]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16))),
            'latin1'
          )
        }
      } else if (isRecognizedLocalFileReference(src)) {
        const filePath = /^file:\/\//i.test(src) ? fileURLToPath(src) : src
        const stat = await fs.promises.stat(filePath)
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null
        bytes = await fs.promises.readFile(filePath)
      } else {
        return null
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) return null
      const detected = await fileTypeFromBuffer(bytes)
      if (!detected?.mime.startsWith('image/') || detected.mime === 'image/svg+xml') return null

      const sharp = (await import('sharp')).default
      const image = sharp(bytes)
      const { width: naturalWidth, height: naturalHeight } = await image.metadata()
      if (
        !naturalWidth ||
        !naturalHeight ||
        naturalWidth <= 0 ||
        naturalHeight <= 0 ||
        !Number.isFinite(naturalWidth) ||
        !Number.isFinite(naturalHeight)
      ) {
        return null
      }
      // Metadata only reads headers; stats forces decoding even for formats embedded unchanged.
      await image.stats()
      if (!(detected.mime in docxImageTypes)) bytes = await transcodeToPng(bytes)
      if (bytes.byteLength > MAX_IMAGE_BYTES) return null
      const embeddedType = await fileTypeFromBuffer(bytes)
      const type = docxImageTypes[embeddedType?.mime as keyof typeof docxImageTypes]
      if (!type) return null
      const scale = Math.min(1, 600 / naturalWidth)
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      return new docx.ImageRun({ type, data: bytes, transformation: { width, height } })
    }

    const processInlineTokens = async (
      tokens: any[],
      isHeaderRow: boolean,
      isQuote = false
    ): Promise<Array<TextRun | ExternalHyperlink | ImageRun>> => {
      const runs: Array<TextRun | ExternalHyperlink | ImageRun> = []
      let linkRuns: Array<TextRun | ImageRun> = []
      let linkUrl = ''
      let boldStack = 0 // 跟踪嵌套的粗体标记
      let italicStack = 0 // 跟踪嵌套的斜体标记
      let strikeStack = 0

      // Off flags are omitted rather than written as `false`: an explicit off overrides the
      // paragraph style, e.g. the italics of Heading 4.
      const runFormat = (): Docx.IRunOptions => ({
        bold: isHeaderRow || boldStack > 0 || undefined,
        italics: isQuote || italicStack > 0 || undefined,
        strike: strikeStack > 0 || undefined
      })

      const pushRun = (options: Docx.IRunOptions) => {
        if (linkUrl) {
          linkRuns.push(new TextRun({ ...options, style: 'Hyperlink', color: '0000FF', underline: { type: 'single' } }))
        } else {
          runs.push(new TextRun(options))
        }
      }

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        switch (token.type) {
          case 'link_open':
            linkUrl = token.attrs.find((attr: [string, string]) => attr[0] === 'href')[1]
            linkRuns = []
            break
          case 'link_close':
            if (linkRuns.length > 0) {
              runs.push(new ExternalHyperlink({ children: linkRuns, link: linkUrl }))
            }
            linkRuns = []
            linkUrl = ''
            break
          case 'strong_open':
            boldStack++
            break
          case 'strong_close':
            boldStack--
            break
          case 'em_open':
            italicStack++
            break
          case 'em_close':
            italicStack--
            break
          case 's_open':
            strikeStack++
            break
          case 's_close':
            strikeStack--
            break
          case 'softbreak':
            pushRun({ text: ' ' })
            break
          case 'hardbreak':
            pushRun({ break: 1 })
            break
          case 'text':
            pushRun({ text: token.content, ...runFormat() })
            break
          case 'image':
            try {
              const image = await resolveImage(token.attrGet('src') ?? '')
              if (image) {
                if (linkUrl) linkRuns.push(image)
                else runs.push(image)
                break
              }
            } catch (error) {
              logger.warn('Unable to embed Word image', error as Error)
            }
            pushRun({ text: inlineText(token.children), ...runFormat() })
            break
          case 'code_inline':
            pushRun({ text: token.content, font: 'Consolas', size: 20, ...runFormat() })
            break
        }
      }
      return runs
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      switch (token.type) {
        case 'heading_open':
          // 获取标题级别 (h1 -> h6)
          const level = parseInt(token.tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6
          elements.push(
            new Paragraph({
              children: await processInlineTokens(tokens[i + 1].children || [], false),
              heading: HeadingLevel[`HEADING_${level}`],
              spacing: {
                before: 240,
                after: 120
              }
            })
          )
          i += 2 // 跳过内容标记和闭合标记
          break

        case 'paragraph_open':
          const inlineTokens = tokens[i + 1].children || []
          const quoteStyle = quoteLevel > 0 ? { indent: { left: quoteLevel * 720 }, border: quoteBorder } : {}
          elements.push(
            new Paragraph({
              children: await processInlineTokens(inlineTokens, false, quoteLevel > 0),
              ...quoteStyle,
              spacing: {
                before: 120,
                after: 120
              }
            })
          )
          i += 2
          break

        case 'bullet_list_open':
          listCounters.push(null)
          break

        case 'ordered_list_open':
          listCounters.push(Number(token.attrGet('start') ?? 1))
          break

        case 'bullet_list_close':
        case 'ordered_list_close':
          listCounters.pop()
          break

        case 'list_item_open':
          const itemNumber = listCounters[listCounters.length - 1]
          if (itemNumber != null) {
            listCounters[listCounters.length - 1] = itemNumber + 1
          }
          // Only a leading paragraph is inlined behind the marker; any other first block (code,
          // quote, nested list) reaches its own handler so container levels stay balanced.
          const hasLeadParagraph = tokens[i + 1].type === 'paragraph_open'
          elements.push(
            new Paragraph({
              children: [
                new TextRun({ text: itemNumber == null ? '•' : `${itemNumber}.`, bold: true }),
                new TextRun({ text: '\t' }),
                ...(hasLeadParagraph
                  ? await processInlineTokens(tokens[i + 2].children || [], false, quoteLevel > 0)
                  : [])
              ],
              indent: { left: (listCounters.length + quoteLevel) * 720 },
              ...(quoteLevel > 0 ? { border: quoteBorder } : {})
            })
          )
          if (hasLeadParagraph) {
            i += 3
          }
          break

        case 'code_block':
        case 'fence': // 代码块
          const codeLines = token.content.replace(/\n$/, '').split('\n')
          elements.push(
            new Paragraph({
              children: codeLines.map(
                (line, index) =>
                  new TextRun({
                    text: line,
                    font: 'Consolas',
                    size: 20,
                    break: index === 0 ? 0 : 1
                  })
              ),
              indent: { left: (listCounters.length + quoteLevel) * 720 },
              shading: {
                type: ShadingType.SOLID,
                color: 'F5F5F5'
              },
              spacing: {
                before: 120,
                after: 120
              },
              border: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' }
              }
            })
          )
          break

        case 'hr':
          elements.push(
            new Paragraph({
              children: [new TextRun({ text: '─'.repeat(50), color: '999999' })],
              alignment: AlignmentType.CENTER
            })
          )
          break

        case 'blockquote_open':
          quoteLevel++
          break

        case 'blockquote_close':
          quoteLevel--
          break

        // 表格处理
        case 'table_open':
          tableRows = [] // Reset table rows for new table
          break

        case 'thead_open':
          isHeaderRow = true
          break

        case 'tbody_open':
          isHeaderRow = false
          break

        case 'tr_open':
          currentRowCells = []
          break

        case 'tr_close':
          const row = new TableRow({
            children: currentRowCells,
            tableHeader: isHeaderRow
          })
          tableRows.push(row)
          // 计算表格有多少列（针对第一行）
          if (tableColumnCount === 0) {
            tableColumnCount = currentRowCells.length
          }
          break

        case 'th_open':
        case 'td_open':
          const isFirstColumn = currentRowCells.length === 0 // 判断是否是第一列
          const borders = {
            top: {
              style: BorderStyle.NONE
            },
            bottom: isHeaderRow
              ? {
                  style: BorderStyle.SINGLE,
                  size: 0.5,
                  color: '000000'
                }
              : {
                  style: BorderStyle.NONE
                },
            left: {
              style: BorderStyle.NONE
            },
            right: {
              style: BorderStyle.NONE
            }
          }
          const cellContent = tokens[i + 1]
          const cellOptions = {
            children: [
              new Paragraph({
                children: cellContent.children
                  ? await processInlineTokens(cellContent.children, isHeaderRow || isFirstColumn)
                  : [new TextRun({ text: cellContent.content || '', bold: isHeaderRow || isFirstColumn })],
                alignment: AlignmentType.CENTER
              })
            ],
            verticalAlign: VerticalAlign.CENTER,
            borders: borders
          }
          currentRowCells.push(new TableCell(cellOptions))
          i += 2 // 跳过内容和结束标记
          break
        case 'table_close':
          // Create table with the collected rows - avoid using protected properties
          // Create the table with all rows
          currentTable = new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE
            },
            rows: tableRows,
            borders: {
              top: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: '000000'
              },
              bottom: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: '000000'
              },
              left: {
                style: BorderStyle.NONE
              },
              right: {
                style: BorderStyle.NONE
              },
              insideHorizontal: {
                style: BorderStyle.NONE
              },
              insideVertical: {
                style: BorderStyle.NONE
              }
            }
          })
          elements.push(currentTable)
          currentTable = null
          tableColumnCount = 0
          tableRows = []
          currentRowCells = []
          isHeaderRow = false
          break
      }
    }

    return elements
  }

  public exportToWord = async (markdown: string, fileName: string, senderId?: string | null): Promise<boolean> => {
    try {
      // Dialog-first is perf-driven: canceling costs zero conversion, and the dialog
      // opens without waiting on the markdown→docx conversion.
      const dialogOptions = {
        title: t('dialog.save_file'),
        filters: [{ name: t('dialog.word_document'), extensions: ['docx'] }],
        defaultPath: fileName
      }
      // Parented dialog avoids the unparented-save crash with Unicode names.
      // Missing or destroyed caller window falls back to the unparented overload.
      const candidate: BrowserWindow | undefined = senderId
        ? application.get('WindowManager').getWindow(senderId)
        : undefined
      const parent = candidate && !candidate.isDestroyed() ? candidate : undefined
      const { canceled, filePath } = parent
        ? await dialog.showSaveDialog(parent, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (canceled || !filePath) {
        return false
      }

      const [{ default: MarkdownIt }, docx] = await Promise.all([import('markdown-it'), import('docx')])
      const md = new MarkdownIt()
      const defaultValidateLink = md.validateLink
      const defaultNormalizeLink = md.normalizeLink
      md.validateLink = (url) => defaultValidateLink(url) || isRecognizedLocalFileReference(url) || isImageDataUri(url)
      md.normalizeLink = (url) => {
        if (isWindowsFileReference(url)) {
          return pathToFileURL(url.replace(/^file:\/\//i, ''), { windows: true }).href
        }
        if (url.startsWith('/')) return pathToFileURL(url, { windows: false }).href
        return defaultNormalizeLink(url)
      }
      // Link validation also changes reference definitions; image-free exports keep the default parser.
      if (!md.parse(markdown, {}).some((token) => token.children?.some((child) => child.type === 'image'))) {
        md.validateLink = defaultValidateLink
        md.normalizeLink = defaultNormalizeLink
      }
      const elements = await this.convertMarkdownToDocxElements(markdown, md, docx)

      const doc = new docx.Document({
        styles: {
          paragraphStyles: [
            {
              id: 'Normal',
              name: 'Normal',
              run: {
                size: 24,
                font: 'Arial'
              }
            }
          ]
        },
        sections: [
          {
            properties: {},
            children: elements
          }
        ]
      })

      const buffer = await docx.Packer.toBuffer(doc)

      await fs.promises.writeFile(filePath, buffer)
      logger.debug('Document exported successfully')
      return true
    } catch (error) {
      logger.error('Export to Word failed:', error as Error)
      throw error
    }
  }
}
