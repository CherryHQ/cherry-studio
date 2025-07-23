/* eslint-disable no-case-declarations */
// ExportService

import { loggerService } from '@logger'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from 'docx'
import { dialog } from 'electron'
import MarkdownIt from 'markdown-it'

import FileStorage from './FileStorage'

const logger = loggerService.withContext('ExportService')
export class ExportService {
  private fileManager: FileStorage
  private md: MarkdownIt

  constructor(fileManager: FileStorage) {
    this.fileManager = fileManager
    this.md = new MarkdownIt()
  }

  private convertMarkdownToDocxElements(markdown: string) {
    const tokens = this.md.parse(markdown, {})
    const elements: any[] = []
    let listLevel = 0
    let currentTable: Table | null = null
    let currentRowCells: TableCell[] = []
    let isHeaderRow = false
    let tableColumnCount = 0
    let tableRows: TableRow[] = [] // Store rows temporarily

    const processInlineTokens = (tokens: any[], isHeaderRow: boolean): (TextRun | ExternalHyperlink)[] => {
      const runs: (TextRun | ExternalHyperlink)[] = []
      let linkText = ''
      let linkUrl = ''
      let insideLink = false
      let boldStack = 0 // 跟踪嵌套的粗体标记
      let italicStack = 0 // 跟踪嵌套的斜体标记

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        switch (token.type) {
          case 'link_open':
            insideLink = true
            linkUrl = token.attrs.find((attr: [string, string]) => attr[0] === 'href')[1]
            linkText = tokens[i + 1].content
            i += 1
            break
          case 'link_close':
            if (insideLink && linkUrl && linkText) {
              // Handle any accumulated link text with the ExternalHyperlink
              runs.push(
                new ExternalHyperlink({
                  children: [
                    new TextRun({
                      text: linkText,
                      style: 'Hyperlink',
                      color: '0000FF',
                      underline: {
                        type: 'single'
                      }
                    })
                  ],
                  link: linkUrl
                })
              )

              // Reset link variables
              linkText = ''
              linkUrl = ''
              insideLink = false
            }
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
          case 'text':
            runs.push(
              new TextRun({
                text: token.content,
                bold: isHeaderRow || boldStack > 0,
                italics: italicStack > 0
              })
            )
            break
          case 'code_inline':
            runs.push(
              new TextRun({
                text: token.content,
                font: 'Consolas',
                size: 20,
                bold: isHeaderRow || boldStack > 0,
                italics: italicStack > 0
              })
            )
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
          const headingText = tokens[i + 1].content
          elements.push(
            new Paragraph({
              text: headingText,
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
          elements.push(
            new Paragraph({
              children: processInlineTokens(inlineTokens, false),
              spacing: {
                before: 120,
                after: 120
              }
            })
          )
          i += 2
          break

        case 'bullet_list_open':
          listLevel++
          break

        case 'bullet_list_close':
          listLevel--
          break

        case 'list_item_open':
          const itemInlineTokens = tokens[i + 2].children || []
          elements.push(
            new Paragraph({
              children: [
                new TextRun({ text: '•', bold: true }),
                new TextRun({ text: '\t' }),
                ...processInlineTokens(itemInlineTokens, false)
              ],
              indent: {
                left: listLevel * 720
              }
            })
          )
          i += 3
          break

        case 'fence': // 代码块
          const codeLines = token.content.split('\n')
          elements.push(
            new Paragraph({
              children: codeLines.map(
                (line) =>
                  new TextRun({
                    text: line + '\n',
                    font: 'Consolas',
                    size: 20,
                    break: 1
                  })
              ),
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
          const quoteText = tokens[i + 2].content
          elements.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: quoteText,
                  italics: true
                })
              ],
              indent: {
                left: 720
              },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 3,
                  color: 'CCCCCC'
                }
              },
              spacing: {
                before: 120,
                after: 120
              }
            })
          )
          i += 3
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

  public exportToWord = async (_: Electron.IpcMainInvokeEvent, markdown: string, fileName: string): Promise<void> => {
    try {
      const elements = this.convertMarkdownToDocxElements(markdown)

      const doc = new Document({
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

      const buffer = await Packer.toBuffer(doc)

      const filePath = dialog.showSaveDialogSync({
        title: '保存文件',
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
        defaultPath: fileName
      })

      if (filePath) {
        await this.fileManager.writeFile(_, filePath, buffer)
        logger.debug('Document exported successfully')
      }
    } catch (error) {
      logger.error('Export to Word failed:', error as Error)
      throw error
    }
  }
}
