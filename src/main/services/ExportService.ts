/* oxlint-disable no-case-declarations */
// ExportService

import fs from 'fs'

import type * as Docx from 'docx'
import type { ExternalHyperlink, Table, TableCell, TableRow, TextRun } from 'docx'
import { dialog } from 'electron'
import type MarkdownIt from 'markdown-it'

import { loggerService } from '@logger'
import { t } from '@main/i18n'

const logger = loggerService.withContext('ExportService')
export class ExportService {
  private convertMarkdownToDocxElements(markdown: string, md: MarkdownIt, docx: typeof Docx) {
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
    const elements: any[] = []
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

    const processInlineTokens = (
      tokens: any[],
      isHeaderRow: boolean,
      isQuote = false
    ): (TextRun | ExternalHyperlink)[] => {
      const runs: (TextRun | ExternalHyperlink)[] = []
      let linkRuns: TextRun[] = []
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
              children: processInlineTokens(tokens[i + 1].children || [], false),
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
              children: processInlineTokens(inlineTokens, false, quoteLevel > 0),
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
                ...(hasLeadParagraph ? processInlineTokens(tokens[i + 2].children || [], false, quoteLevel > 0) : [])
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
                  ? processInlineTokens(cellContent.children, isHeaderRow || isFirstColumn)
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

  public exportToWord = async (markdown: string, fileName: string): Promise<void> => {
    try {
      // Dialog-first is perf-driven: canceling costs zero conversion, and the dialog
      // opens without waiting on the markdown→docx conversion.
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: t('dialog.save_file'),
        filters: [{ name: t('dialog.word_document'), extensions: ['docx'] }],
        defaultPath: fileName
      })
      if (canceled || !filePath) {
        return
      }

      const [{ default: MarkdownIt }, docx] = await Promise.all([import('markdown-it'), import('docx')])
      const elements = this.convertMarkdownToDocxElements(markdown, new MarkdownIt(), docx)

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
    } catch (error) {
      logger.error('Export to Word failed:', error as Error)
      throw error
    }
  }
}
