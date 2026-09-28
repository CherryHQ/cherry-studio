import { setImmediate as yieldToEventLoop } from 'node:timers/promises'

import type PptxGenJS from 'pptxgenjs'

import type { DocumentBlock } from './parseMarkdown'

export async function convertPptx(
  blocks: DocumentBlock[],
  images: Map<string, Buffer>,
  title: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const presentation = new PptxGenJS()
  presentation.layout = 'LAYOUT_WIDE'
  presentation.title = title
  presentation.author = 'Cherry Studio'
  presentation.subject = title
  presentation.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  let slide: PptxGenJS.Slide | undefined
  let heading = title
  let y = 1.2
  let processed = 0
  const newSlide = (name = heading) => {
    slide = presentation.addSlide()
    slide.addText(name, {
      x: 0.6,
      y: 0.35,
      w: 12.1,
      h: 0.65,
      fontSize: 28,
      bold: true,
      breakLine: false,
      fit: 'shrink'
    })
    y = 1.25
    return slide
  }
  const ensureSpace = (height: number) => {
    if (!slide || y + height > 6.95) return newSlide()
    return slide
  }

  for (const block of blocks) {
    signal?.throwIfAborted()
    if (++processed % 32 === 0) await yieldToEventLoop(undefined, { signal })
    if (block.type === 'heading' && block.level <= 2) {
      heading = block.text
      newSlide()
    } else if (block.type === 'image') {
      const image = images.get(block.source)
      if (!image) continue
      const data = `image/png;base64,${image.toString('base64')}`
      const target = ensureSpace(3.5)
      target.addImage({
        data,
        x: 0.65,
        y,
        w: 12,
        h: 3.3,
        sizing: { type: 'contain', w: 12, h: 3.3 },
        altText: block.text
      })
      y += 3.5
    } else if (block.type === 'table') {
      const rows = block.rows
      const autoPage = rows.length > 10 || rows.some((row) => row.some((cell) => cell.length > 80))
      const height = Math.min(5.2, rows.length * 0.5)
      const target = autoPage && y > 1.25 ? newSlide() : ensureSpace(height)
      target.addTable(
        rows.map((row) => row.map((text) => ({ text }))),
        {
          x: 0.65,
          y,
          w: 12,
          fontFace: 'Arial',
          fontSize: 14,
          color: '202020',
          border: { color: 'D0D0D0', pt: 1 },
          margin: 0.08,
          autoPage,
          autoPageRepeatHeader: true,
          autoPageSlideStartY: 1.25
        }
      )
      y = autoPage ? 7 : y + height + 0.18
    } else if ('text' in block) {
      const isCode = block.type === 'code'
      const isHeading = block.type === 'heading'
      const fontSize = isCode ? 15 : isHeading ? 22 : 20
      const width = 12 - (block.type === 'text' && block.bullet ? Math.min(block.bullet - 1, 5) * 0.3 : 0)
      // Bound each text box by visual lines; long sections continue on the next slide.
      const lineLength = isCode ? 95 : 70
      const lines = block.text
        .split('\n')
        .flatMap((line) =>
          Array.from(line.matchAll(new RegExp(`.{1,${lineLength}}`, 'gu')), ([text]) => text).concat(line ? [] : [''])
        )
      for (let offset = 0; offset < lines.length; offset += 10) {
        const text = lines.slice(offset, offset + 10).join('\n')
        const height = Math.min(5.3, Math.max(0.5, text.split('\n').length * (isCode ? 0.3 : 0.4)))
        const target = ensureSpace(height)
        const bullet = block.type === 'text' && block.bullet ? { indent: 18 } : undefined
        target.addText(text, {
          x: 12.65 - width,
          y,
          w: width,
          h: height,
          fontSize,
          fontFace: isCode ? 'Consolas' : 'Arial',
          bold: isHeading,
          valign: 'top',
          margin: 0,
          breakLine: false,
          fit: 'shrink',
          bullet,
          paraSpaceAfter: 5
        })
        y += height + 0.18
      }
    }
  }
  if (!slide) newSlide()
  signal?.throwIfAborted()
  const result = await presentation.write({ outputType: 'nodebuffer', compression: true })
  signal?.throwIfAborted()
  return Buffer.from(result as Buffer)
}
