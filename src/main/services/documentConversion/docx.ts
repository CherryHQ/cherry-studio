import type * as Docx from 'docx'

import type { DocumentBlock, DocumentTextRun } from './documentModel'

export async function convertDocx(
  blocks: DocumentBlock[],
  images: Map<string, Buffer>,
  title: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const docx = await import('docx')
  const { default: sharp } = await import('sharp')
  const numbering: Docx.INumberingOptions['config'][number][] = []
  const run = (item: DocumentTextRun): (Docx.TextRun | Docx.ExternalHyperlink)[] => {
    const children = item.text.split('\n').map(
      (text, index) =>
        new docx.TextRun({
          text,
          break: index ? 1 : undefined,
          bold: item.bold,
          italics: item.italic,
          strike: item.strike,
          underline: item.underline ? {} : undefined,
          font: item.font,
          size: item.size ? Math.round(item.size * 2) : undefined,
          color: item.color,
          shading: item.background ? { fill: item.background } : undefined
        })
    )
    return item.link && /^(?:https?:|mailto:)/.test(item.link)
      ? [new docx.ExternalHyperlink({ link: item.link, children })]
      : children
  }
  const listMarker = (block: {
    bullet?: number
    orderedNumber?: number
  }): Pick<Docx.IParagraphOptions, 'bullet' | 'numbering'> => {
    const level = block.bullet ? Math.min(8, block.bullet - 1) : 0
    if (block.orderedNumber === undefined) return block.bullet ? { bullet: { level } } : {}
    const reference = `ordered-${numbering.length}`
    numbering.push({
      reference,
      levels: [
        {
          level,
          format: docx.LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          start: block.orderedNumber,
          alignment: docx.AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 720 * (level + 1), hanging: 360 }
            }
          }
        }
      ]
    })
    return { numbering: { reference, level } }
  }
  // 720 twips per depth matches ordered levels and the built-in bullet indents.
  const listIndent = (block: { bullet?: number; listDepth?: number; style?: { indent?: number } }) => {
    const listed = !block.bullet && block.listDepth ? 720 * Math.min(9, block.listDepth) : 0
    const styled = block.style?.indent ? Math.round(block.style.indent * 20) : 0
    const left = listed + styled
    return left ? { left } : undefined
  }
  const render = async (items: DocumentBlock[], availableWidth = 650): Promise<(Docx.Paragraph | Docx.Table)[]> => {
    const result: (Docx.Paragraph | Docx.Table)[] = []
    for (const block of items) {
      signal?.throwIfAborted()
      if (block.type === 'columns') {
        const total = block.widths.reduce((sum, width) => sum + width, 0) || block.columns.length
        result.push(
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            borders: {
              top: { style: docx.BorderStyle.NONE },
              bottom: { style: docx.BorderStyle.NONE },
              left: { style: docx.BorderStyle.NONE },
              right: { style: docx.BorderStyle.NONE },
              insideHorizontal: { style: docx.BorderStyle.NONE },
              insideVertical: { style: docx.BorderStyle.NONE }
            },
            rows: [
              new docx.TableRow({
                children: await Promise.all(
                  block.columns.map(async (column, index) => {
                    const fraction = (block.widths[index] || 1) / total
                    const children = await render(column, availableWidth * fraction)
                    return new docx.TableCell({
                      width: { size: 100 * fraction, type: docx.WidthType.PERCENTAGE },
                      children: children.length ? children : [new docx.Paragraph('')]
                    })
                  })
                )
              })
            ]
          })
        )
      } else if (block.type === 'image') {
        const data = images.get(block.source)
        if (!data) throw new Error('Document image is unavailable')
        const metadata = await sharp(data).metadata()
        const originalWidth = block.width || metadata.width || 400
        const originalHeight = block.height || metadata.height || 300
        const width = Math.min(availableWidth, originalWidth)
        const indent = listIndent(block)
        result.push(
          new docx.Paragraph({
            ...listMarker(block),
            ...(indent ? { indent } : {}),
            children: [
              new docx.ImageRun({
                type: 'png',
                data,
                transformation: {
                  width: Math.round(width),
                  height: Math.round((originalHeight * width) / originalWidth)
                },
                altText: { title: block.text, description: block.text, name: block.text }
              })
            ]
          })
        )
      } else if (block.type === 'table') {
        const tableDepth = block.listDepth ?? block.bullet ?? 0
        if (block.bullet) {
          result.push(
            new docx.Paragraph({
              ...listMarker(block),
              children: [new docx.TextRun('\u00a0')]
            })
          )
        }
        result.push(
          new docx.Table({
            width: { size: 100, type: docx.WidthType.PERCENTAGE },
            ...(tableDepth ? { indent: { size: 720 * Math.min(9, tableDepth), type: docx.WidthType.DXA } } : {}),
            columnWidths: block.widths?.map((width) => Math.round(width * 15)),
            rows: block.rows.map(
              (row, rowIndex) =>
                new docx.TableRow({
                  tableHeader: rowIndex === 0,
                  children: row.flatMap((text, column) => {
                    const cell = block.cells?.[rowIndex]?.[column]
                    if (cell?.covered) return []
                    const border = {
                      style: docx.BorderStyle.SINGLE,
                      size: Math.round((cell?.borderWidth ?? 0.5) * 8),
                      color: cell?.borderColor ?? 'B0B0B0'
                    }
                    return [
                      new docx.TableCell({
                        columnSpan: cell?.colSpan,
                        rowSpan: cell?.rowSpan,
                        shading: cell?.background ? { fill: cell.background } : undefined,
                        borders: { top: border, bottom: border, left: border, right: border },
                        children: [
                          new docx.Paragraph({
                            alignment: cell?.align === 'justify' ? docx.AlignmentType.JUSTIFIED : cell?.align,
                            children: (cell?.runs ?? [{ text }]).flatMap(run)
                          })
                        ]
                      })
                    ]
                  })
                })
            )
          })
        )
      } else {
        const style = block.style
        const indent = listIndent(block)
        const heading =
          block.type === 'heading'
            ? (`Heading${Math.min(6, block.level)}` as Docx.IParagraphOptions['heading'])
            : undefined
        result.push(
          new docx.Paragraph({
            heading,
            alignment: style?.align === 'justify' ? docx.AlignmentType.JUSTIFIED : style?.align,
            spacing: { before: Math.round((style?.before ?? 0) * 20), after: Math.round((style?.after ?? 8) * 20) },
            ...(indent ? { indent } : {}),
            shading: style?.background ? { fill: style.background } : undefined,
            ...listMarker(block),
            children: (
              block.runs ?? [{ text: block.text, ...(block.type === 'code' ? { font: 'Consolas' } : {}) }]
            ).flatMap(run)
          })
        )
      }
    }
    return result
  }
  const children = await render(blocks)
  const document = new docx.Document({
    title,
    creator: 'Cherry Studio',
    numbering: { config: numbering },
    sections: [{ children }]
  })
  const bytes = await docx.Packer.toBuffer(document)
  signal?.throwIfAborted()
  return bytes
}
