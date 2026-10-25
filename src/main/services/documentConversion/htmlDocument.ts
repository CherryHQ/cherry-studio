import type { DocumentBlock, DocumentCell, DocumentModel, DocumentStyle, DocumentTextRun } from './documentModel'

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
  const runs = (root: Node | Node[]): DocumentTextRun[] => {
    const result: DocumentTextRun[] = []
    let deferredBreak = false
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
        const style = getComputedStyle(node.parentElement)
        if (style.display === 'none' || style.visibility === 'hidden') return
        const text = style.whiteSpace.startsWith('pre')
          ? (node.textContent ?? '')
          : (node.textContent ?? '').replace(/\s+/g, ' ')
        if (!text) return
        if (deferredBreak && text.trim()) {
          deferredBreak = false
          const previous = result[result.length - 1]
          if (previous && !previous.text.endsWith('\n')) result.push({ text: '\n' })
        }
        result.push({
          text,
          bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
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
        if (node.tagName === 'BR') {
          result.push({ text: '\n' })
          deferredBreak = false
          return
        }
        if (['block', 'flex', 'grid', 'flow-root', 'list-item', 'table'].includes(style.display)) {
          if (result.some((run) => run.text.trim())) deferredBreak = true
          const start = result.length
          node.childNodes.forEach(visit)
          if (result.slice(start).some((run) => run.text.trim())) deferredBreak = true
          return
        }
        node.childNodes.forEach(visit)
      }
    }
    if (Array.isArray(root)) root.forEach(visit)
    else if (root instanceof Element) root.childNodes.forEach(visit)
    else visit(root)
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
          height: rect.height || image.naturalHeight,
          ...(listDepth ? { listDepth } : {})
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
      // Spreading one argument per row throws once a table exceeds the engine limit.
      let width = 0
      for (const row of cells) if (row.length > width) width = row.length
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
        ),
        ...(listDepth ? { listDepth } : {})
      }
      return [table, ...Array.from(element.querySelectorAll('img')).flatMap((image) => walk(image, listDepth))]
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
        const style = getComputedStyle(child)
        if (tag !== 'OL' || child.tagName !== 'LI' || style.display === 'none' || style.visibility === 'hidden')
          return blocks
        if (child.hasAttribute('value')) number = Number(child.getAttribute('value'))
        const first = findMarker(blocks, listDepth + 1)
        if (first) first.orderedNumber = number
        number++
        return blocks
      })
    }
    if (tag === 'LI') {
      const inner = contained(element, listDepth)
      if (!listDepth) return inner
      let opened = false
      const openParent = (): DocumentBlock[] => {
        if (opened) return []
        opened = true
        return [{ type: 'text', text: '', bullet: listDepth, listDepth }]
      }
      const visit = (block: DocumentBlock): DocumentBlock[] => {
        if (block.type === 'columns')
          return [{ ...block, columns: block.columns.map((column) => column.flatMap(visit)) }]
        if ((block.listDepth ?? 0) > listDepth || (block.bullet ?? 0) > listDepth) return [...openParent(), block]
        const itemStart = !opened
        opened = true
        return [place(block, listDepth, itemStart)]
      }
      return inner.flatMap(visit)
    }
    if (['absolute', 'fixed', 'sticky'].includes(css.position) || css.transform !== 'none' || css.filter !== 'none')
      warnings.add('complex_layout')
    if ((css.display === 'flex' || css.display === 'grid') && !/^H[1-6]$/.test(tag)) {
      const hasDirectText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
      )
      const children = Array.from(element.children).filter((child) => getComputedStyle(child).display !== 'none')
      const boxes = children.map((child) => child.getBoundingClientRect())
      const isRow =
        !hasDirectText &&
        children.length >= 2 &&
        children.length <= 3 &&
        boxes.every((box) => Math.abs(box.top - boxes[0].top) < 5)
      if (isRow) {
        if (listDepth) warnings.add('complex_layout')
        return [
          {
            type: 'columns',
            columns: children.map((child) => walk(child, listDepth)),
            widths: boxes.map((box) => box.width),
            ...(listDepth ? { listDepth } : {})
          }
        ]
      }
      warnings.add('complex_layout')
    } else if (/^H[1-6]$/.test(tag) && (css.display === 'flex' || css.display === 'grid'))
      warnings.add('complex_layout')
    return contained(element, listDepth)

    function findMarker(
      blocks: DocumentBlock[],
      depth: number
    ): Exclude<DocumentBlock, { type: 'columns' }> | undefined {
      for (const block of blocks) {
        if (block.type === 'columns') {
          for (const column of block.columns) {
            const found = findMarker(column, depth)
            if (found) return found
          }
          continue
        }
        if (block.bullet === depth) return block
      }
      return undefined
    }

    function place(block: DocumentBlock, depth: number, itemStart: boolean): DocumentBlock {
      if (block.type === 'columns') return block
      const next = { ...block }
      delete next.bullet
      delete next.orderedNumber
      delete next.listDepth
      return itemStart ? { ...next, bullet: depth, listDepth: depth } : { ...next, listDepth: depth }
    }

    function displayOf(node: Element): string {
      return getComputedStyle(node).display || 'inline'
    }

    function isStructural(node: Element): boolean {
      if (node.tagName === 'BR' || node.tagName === 'IMG') return false
      return !['inline', 'inline-block', 'contents'].includes(displayOf(node))
    }

    function contained(node: Element, depth: number): DocumentBlock[] {
      const structural = Array.from(node.children).some((child) => isStructural(child))
      const hasImage = !!node.querySelector('img')
      const membership = depth ? { listDepth: depth } : {}
      if (!structural && !hasImage) {
        const content = runs(node)
        const rawText = content.map((run) => run.text).join('')
        const text = node.tagName === 'PRE' ? rawText : rawText.trim()
        if (!text) return []
        if (/^H[1-6]$/.test(node.tagName))
          return [
            {
              type: 'heading',
              level: Number(node.tagName[1]),
              text,
              runs: content,
              style: styleOf(node),
              ...membership
            }
          ]
        return [
          {
            type: node.tagName === 'PRE' ? 'code' : 'text',
            text,
            runs: content,
            style: styleOf(node),
            ...membership
          }
        ]
      }
      const blocks: DocumentBlock[] = []
      let pending: Node[] = []
      let headingPlaced = false
      const headingLevel = /^H[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0
      const flush = () => {
        if (!pending.length) return
        const content = runs(pending)
        const rawText = content.map((run) => run.text).join('')
        const preserve = node.tagName === 'PRE'
        const text = preserve ? rawText : rawText.trim()
        if (text) {
          const fields = { text, runs: content, style: styleOf(node), ...membership }
          emit([preserve ? { type: 'code', ...fields } : { type: 'text', ...fields }])
        }
        pending = []
      }
      function claimHeading(block: DocumentBlock): DocumentBlock {
        if (!headingLevel || headingPlaced) return block
        if (block.type === 'columns') {
          return { ...block, columns: block.columns.map((column) => column.map(claimHeading)) }
        }
        if (block.type !== 'text' && block.type !== 'heading') return block
        headingPlaced = true
        return { ...block, type: 'heading', level: headingLevel }
      }
      function emit(incoming: DocumentBlock[]) {
        for (const block of incoming) blocks.push(claimHeading(block))
      }
      const visit = (child: Node) => {
        if (!(child instanceof Element)) {
          if (child.textContent) pending.push(child)
          return
        }
        if (child.tagName === 'IMG') {
          flush()
          emit(walk(child, depth))
          return
        }
        if (isStructural(child)) {
          flush()
          emit(walk(child, depth))
          return
        }
        if (child.querySelector('img')) {
          for (const nested of Array.from(child.childNodes)) visit(nested)
          return
        }
        pending.push(child)
      }
      for (const child of Array.from(node.childNodes)) visit(child)
      flush()
      return blocks
    }
  }
  return { blocks: walk(document.body), warnings: [...warnings] }
}
