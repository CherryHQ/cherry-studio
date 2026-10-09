import type {
  DocumentBlock,
  DocumentCell,
  DocumentModel,
  DocumentStyle,
  DocumentTextRun
} from '@shared/types/documentModel'

/** Runs in the isolated Chromium document; keep every helper inside the function. */
export function extractHtmlDocument(): DocumentModel {
  const warnings = new Set<string>()
  const color = (value: string): string | undefined => {
    const channels = value.match(/[\d.]+/g)?.map(Number)
    if (!channels || channels.length < 3 || channels[3] === 0) return undefined
    return channels
      .slice(0, 3)
      .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  const px = (value: string) => Number.parseFloat(value) || 0
  const runs = (root: Element): DocumentTextRun[] => {
    const result: DocumentTextRun[] = []
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
        const style = getComputedStyle(node.parentElement)
        if (style.display === 'none' || style.visibility === 'hidden') return
        const text = style.whiteSpace.startsWith('pre')
          ? (node.textContent ?? '')
          : (node.textContent ?? '').replace(/\s+/g, ' ')
        if (!text) return
        result.push({
          text,
          bold: Number(style.fontWeight) >= 600,
          italic: style.fontStyle === 'italic',
          underline: style.textDecorationLine.includes('underline'),
          strike: style.textDecorationLine.includes('line-through'),
          font: style.fontFamily
            .split(',')[0]
            .trim()
            .replace(/^['"]|['"]$/g, ''),
          size: px(style.fontSize) * 0.75,
          color: color(style.color),
          background: color(style.backgroundColor),
          link: node.parentElement.closest('a')?.getAttribute('href') ?? undefined
        })
      } else if (node instanceof Element) {
        const style = getComputedStyle(node)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          ['SCRIPT', 'STYLE', 'IMG'].includes(node.tagName)
        )
          return
        if (node.tagName === 'BR') result.push({ text: '\n' })
        else node.childNodes.forEach(visit)
      }
    }
    root.childNodes.forEach(visit)
    return result
  }
  const styleOf = (element: Element): DocumentStyle => {
    const css = getComputedStyle(element)
    const align = css.textAlign === 'start' ? 'left' : css.textAlign === 'end' ? 'right' : css.textAlign
    return {
      align: ['left', 'center', 'right', 'justify'].includes(align) ? (align as DocumentStyle['align']) : undefined,
      before: px(css.marginTop) * 0.75,
      after: px(css.marginBottom) * 0.75,
      indent: px(css.marginLeft) * 0.75,
      background: color(css.backgroundColor)
    }
  }
  const walk = (element: Element, listDepth = 0): DocumentBlock[] => {
    const css = getComputedStyle(element)
    if (css.display === 'none' || css.visibility === 'hidden') return []
    const tag = element.tagName
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE'].includes(tag)) return []
    if (['CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'INPUT', 'SELECT', 'BUTTON'].includes(tag)) {
      warnings.add('complex_layout')
      return []
    }
    if (tag === 'IMG') {
      const image = element as HTMLImageElement
      const rect = element.getBoundingClientRect()
      return [
        {
          type: 'image',
          source: image.src,
          text: image.alt,
          width: rect.width || image.naturalWidth,
          height: rect.height || image.naturalHeight
        }
      ]
    }
    if (tag === 'TABLE') {
      const rows = Array.from((element as HTMLTableElement).rows)
      const cells: DocumentCell[][] = []
      const widths: number[] = []
      rows.forEach((row, rowIndex) => {
        cells[rowIndex] ??= []
        let column = 0
        for (const cell of Array.from(row.cells)) {
          while (cells[rowIndex][column]) column++
          const colSpan = Math.min(cell.colSpan || 1, 100)
          const rowSpan = Math.min(cell.rowSpan || rows.length - rowIndex, rows.length - rowIndex)
          const style = getComputedStyle(cell)
          cells[rowIndex][column] = {
            runs: runs(cell),
            colSpan,
            rowSpan,
            background: color(style.backgroundColor),
            borderColor: color(style.borderTopColor),
            borderWidth: px(style.borderTopWidth) * 0.75,
            align: styleOf(cell).align
          }
          for (let r = 0; r < rowSpan; r++)
            for (let c = 0; c < colSpan; c++) {
              cells[rowIndex + r] ??= []
              if (r || c) cells[rowIndex + r][column + c] = { runs: [], covered: true }
              widths[column + c] = Math.max(widths[column + c] ?? 0, cell.getBoundingClientRect().width / colSpan)
            }
          column += colSpan
        }
      })
      const width = Math.max(0, ...cells.map((row) => row.length))
      for (const row of cells) for (let c = 0; c < width; c++) row[c] ??= { runs: [] }
      const table: DocumentBlock = {
        type: 'table',
        title: (element as HTMLTableElement).caption?.textContent ?? '',
        cells,
        widths,
        rows: cells.map((row) =>
          row.map((cell) =>
            cell.runs
              .map((run) => run.text)
              .join('')
              .trim()
          )
        )
      }
      return [table, ...Array.from(element.querySelectorAll('img')).flatMap((image) => walk(image))]
    }
    if (tag === 'UL' || tag === 'OL') {
      let number = Number(element.getAttribute('start') ?? 1)
      if (
        tag === 'OL' &&
        (element.hasAttribute('reversed') || ['a', 'A', 'i', 'I'].includes(element.getAttribute('type') ?? ''))
      )
        warnings.add('complex_layout')
      return Array.from(element.children).flatMap((child) => {
        const blocks = walk(child, listDepth + 1)
        if (tag === 'OL') {
          if (child.hasAttribute('value')) number = Number(child.getAttribute('value'))
          const first = blocks.find((block) => block.type === 'text')
          if (first?.type === 'text') first.orderedNumber = number++
        }
        return blocks
      })
    }
    if (['absolute', 'fixed', 'sticky'].includes(css.position) || css.transform !== 'none' || css.filter !== 'none')
      warnings.add('complex_layout')
    if (css.display === 'flex' || css.display === 'grid') {
      const children = Array.from(element.children).filter((child) => getComputedStyle(child).display !== 'none')
      const boxes = children.map((child) => child.getBoundingClientRect())
      const isRow =
        children.length >= 2 && children.length <= 3 && boxes.every((box) => Math.abs(box.top - boxes[0].top) < 5)
      if (isRow)
        return [
          {
            type: 'columns',
            columns: children.map((child) => walk(child, listDepth)),
            widths: boxes.map((box) => box.width)
          }
        ]
      warnings.add('complex_layout')
    }
    const hasBlockChildren = Array.from(element.children).some(
      (child) =>
        !['inline', 'inline-block', 'contents'].includes(getComputedStyle(child).display) && child.tagName !== 'IMG'
    )
    if (!hasBlockChildren) {
      const content = runs(element)
      const text = content
        .map((run) => run.text)
        .join('')
        .trim()
      const blocks: DocumentBlock[] = []
      if (text)
        blocks.push(
          /^H[1-6]$/.test(tag)
            ? { type: 'heading', level: Number(tag[1]), text, runs: content, style: styleOf(element) }
            : {
                type: tag === 'PRE' ? 'code' : 'text',
                text,
                runs: content,
                style: styleOf(element),
                ...(listDepth ? { bullet: listDepth } : {})
              }
        )
      blocks.push(...Array.from(element.querySelectorAll('img')).flatMap((image) => walk(image)))
      return blocks
    }
    return Array.from(element.childNodes).flatMap((node): DocumentBlock[] => {
      if (node instanceof Element) return walk(node, listDepth)
      const text = node.textContent?.trim()
      return text ? [{ type: 'text', text, style: styleOf(element), ...(listDepth ? { bullet: listDepth } : {}) }] : []
    })
  }
  return { blocks: walk(document.body), warnings: [...warnings] }
}
