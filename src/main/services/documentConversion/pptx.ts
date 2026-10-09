import { setImmediate as yieldToEventLoop } from 'node:timers/promises'

import type PptxGenJS from 'pptxgenjs'

import type { DocumentBlock, DocumentStyle, DocumentTextRun } from '@shared/types/documentModel'

function textRuns(runs: DocumentTextRun[]): PptxGenJS.TextProps[] {
  return runs.map((run) => ({
    text: run.text,
    options: {
      bold: run.bold,
      italic: run.italic,
      strike: run.strike,
      underline: run.underline ? {} : undefined,
      fontFace: run.font,
      fontSize: run.size,
      color: run.color,
      highlight: run.background,
      ...(run.link && /^https?:/.test(run.link) ? { hyperlink: { url: run.link } } : {})
    }
  }))
}

function splitRuns(runs: DocumentTextRun[], capacity: number): DocumentTextRun[][] {
  const chunks: DocumentTextRun[][] = [[]]
  let used = 0
  for (const run of runs) {
    let part = ''
    for (const character of run.text) {
      const weight = character === '\n' ? 45 : character.codePointAt(0)! > 255 ? 2 : 1
      if (used + weight > capacity && used) {
        if (part) chunks.at(-1)!.push({ ...run, text: part })
        part = ''
        chunks.push([])
        used = 0
      }
      part += character
      used += weight
    }
    if (part) chunks.at(-1)!.push({ ...run, text: part })
  }
  return chunks
}

function textLayout(block: Extract<DocumentBlock, { text: string }>, width: number) {
  const baseSize = block.type === 'heading' ? 22 : block.type === 'code' ? 14 : 18
  const chunks = splitRuns('runs' in block && block.runs ? block.runs : [{ text: block.text }], Math.round(width * 65))
  return chunks.map((chunk) => {
    const weighted = chunk.reduce(
      (sum, run) =>
        sum +
        Array.from(run.text).reduce((n, char) => n + (char === '\n' ? 45 : char.codePointAt(0)! > 255 ? 2 : 1), 0),
      0
    )
    const fontSize = Math.min(36, Math.max(baseSize, ...chunk.map((run) => run.size ?? baseSize)))
    const lines = Math.max(1, Math.ceil(weighted / Math.max(15, (width * 72) / (fontSize * 0.55))))
    return { chunk, baseSize, height: Math.min(5.3, Math.max(0.45, ((lines * fontSize) / 72) * 1.3)) }
  })
}

export async function convertPptx(
  blocks: DocumentBlock[],
  images: Map<string, Buffer>,
  title: string,
  signal?: AbortSignal,
  warnings: string[] = []
): Promise<Buffer> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const presentation = new PptxGenJS()
  presentation.layout = 'LAYOUT_WIDE'
  presentation.title = title
  presentation.author = 'Cherry Studio'
  let slide: PptxGenJS.Slide | undefined
  let heading = title
  let y = 1.25
  let headingStyle: DocumentStyle | undefined
  const newSlide = (runs?: DocumentTextRun[]) => {
    slide = presentation.addSlide()
    slide.addText(runs ? textRuns(runs) : heading, {
      x: 0.6,
      y: 0.3,
      w: 12.1,
      h: 0.7,
      fontSize: 28,
      bold: true,
      fit: 'shrink',
      margin: 0,
      align: headingStyle?.align,
      paraSpaceBefore: headingStyle?.before,
      paraSpaceAfter: headingStyle?.after
    })
    y = 1.25
    return slide
  }
  const ensureSpace = (height: number) => (!slide || y + height > 6.95 ? newSlide() : slide)
  const render = async (items: DocumentBlock[], x = 0.65, width = 12): Promise<void> => {
    for (const block of items) {
      signal?.throwIfAborted()
      await yieldToEventLoop(undefined, { signal })
      if (block.type === 'columns') {
        const sum = block.widths.reduce((total, value) => total + value, 0) || block.columns.length
        const widths = block.columns.map((_column, index) => (width * (block.widths[index] || 1)) / sum)
        const heights = block.columns.map((column, index) =>
          column.reduce((total, item) => {
            if (item.type === 'columns') return Infinity
            if (item.type === 'table')
              return item.rows.length > 8 ||
                item.rows.some((row) =>
                  row.some((cell) => cell.length > Math.min(80, ((widths[index] - 0.2) / Math.max(1, row.length)) * 7))
                )
                ? Infinity
                : total + item.rows.length * 0.45 + 0.15
            if (item.type === 'image') return total + 3.45
            return (
              total + textLayout(item, widths[index] - 0.2).reduce((height, layout) => height + layout.height + 0.15, 0)
            )
          }, 0)
        )
        const height = Math.max(...heights)
        if (height > 5.5 || widths.some((columnWidth) => columnWidth < 1)) {
          warnings.push('complex_layout')
          for (const column of block.columns) await render(column, x, width)
          continue
        }
        ensureSpace(height)
        const start = y
        let bottom = y
        let columnX = x
        for (const [index, column] of block.columns.entries()) {
          y = start
          const columnWidth = widths[index]
          await render(column, columnX, columnWidth - 0.2)
          columnX += columnWidth
          bottom = Math.max(bottom, y)
        }
        y = bottom
      } else if (block.type === 'heading' && block.level <= 2 && width === 12) {
        heading = block.text
        headingStyle = block.style
        newSlide(block.runs)
      } else if (block.type === 'image') {
        const image = images.get(block.source)
        if (!image) throw new Error('Document image is unavailable')
        const { default: sharp } = await import('sharp')
        const info = await sharp(image).metadata()
        const ratio = (block.width || info.width || 400) / (block.height || info.height || 300)
        const height = Math.min(3.3, width / ratio)
        const imageWidth = height * ratio
        const target = ensureSpace(height + 0.15)
        target.addImage({
          data: `image/png;base64,${image.toString('base64')}`,
          x,
          y,
          w: imageWidth,
          h: height,
          altText: block.text
        })
        y += height + 0.15
      } else if (block.type === 'table') {
        const autoPage = block.rows.length > 8 || block.rows.some((row) => row.some((cell) => cell.length > 80))
        const height = Math.min(5.3, block.rows.length * 0.45)
        const target = autoPage && y > 1.25 ? newSlide() : ensureSpace(height)
        const rows: PptxGenJS.TableRow[] = block.rows.map((row, rowIndex) =>
          row.flatMap((text, column): PptxGenJS.TableCell[] => {
            const cell = block.cells?.[rowIndex]?.[column]
            if (cell?.covered) return []
            return [
              {
                text: textRuns(cell?.runs ?? [{ text }]),
                options: {
                  colspan: cell?.colSpan,
                  rowspan: cell?.rowSpan,
                  fill: cell?.background ? { color: cell.background } : undefined,
                  align: cell?.align,
                  border: { color: cell?.borderColor ?? 'B0B0B0', pt: cell?.borderWidth ?? 0.5 }
                }
              }
            ]
          })
        )
        const totalWidth = block.widths?.reduce((sum, value) => sum + value, 0)
        target.addTable(rows, {
          x,
          y,
          w: width,
          fontSize: 14,
          margin: 0.07,
          color: '202020',
          colW: totalWidth ? block.widths!.map((value) => (value / totalWidth) * width) : undefined,
          autoPage,
          autoPageRepeatHeader: true,
          autoPageHeaderRows: 1,
          autoPageSlideStartY: 1.25
        })
        y = autoPage ? 7 : y + height + 0.15
      } else if ('text' in block) {
        const isHeading = block.type === 'heading'
        for (const { chunk, baseSize, height } of textLayout(block, width)) {
          const target = ensureSpace(height)
          target.addText(textRuns(chunk), {
            x,
            y,
            w: width,
            h: height,
            fontSize: baseSize,
            bold: isHeading,
            fontFace: block.type === 'code' ? 'Consolas' : 'Arial',
            fit: 'shrink',
            valign: 'top',
            margin: 0,
            align: block.style?.align,
            fill: block.style?.background ? { color: block.style.background } : undefined,
            paraSpaceBefore: block.style?.before,
            paraSpaceAfter: block.style?.after ?? 5,
            bullet:
              block.type === 'text' && block.bullet
                ? {
                    indent: 18,
                    ...(block.orderedNumber !== undefined ? { type: 'number', numberStartAt: block.orderedNumber } : {})
                  }
                : undefined
          })
          y += height + 0.15
        }
      }
    }
  }
  await render(blocks)
  if (!slide) newSlide()
  signal?.throwIfAborted()
  const result = await presentation.write({ outputType: 'nodebuffer', compression: true })
  signal?.throwIfAborted()
  return Buffer.from(result as Buffer)
}
