import type { PhrasingContent, Root, Text } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkStringify, { type Options } from 'remark-stringify'
import { unified } from 'unified'

import type { DocumentBlock, DocumentStyle, DocumentTextRun } from './documentModel'

function attentionNode(node: { type?: string } | undefined): boolean {
  return node?.type === 'strong' || node?.type === 'emphasis' || node?.type === 'delete'
}

const handlers = {
  text(node: Text, parent, state, info) {
    const chars = Array.from(node.value)
    if (!chars.length) return ''
    const siblings = parent && 'children' in parent ? parent.children : undefined
    const index = siblings?.indexOf(node) ?? -1
    const inside = attentionNode(parent)
    const encodeStart = inside || (index > 0 && attentionNode(siblings?.[index - 1]))
    const encodeEnd = inside || (index >= 0 && attentionNode(siblings?.[index + 1]))
    if (!encodeStart && !encodeEnd) return state.safe(node.value, info)
    const encode = (char: string) =>
      /\s/u.test(char) ? char : `&#x${char.codePointAt(0)!.toString(16).toUpperCase()};`
    if (chars.length === 1) return encode(chars[0])
    const middle = chars.slice(encodeStart ? 1 : 0, encodeEnd ? -1 : undefined).join('')
    return (
      (encodeStart ? encode(chars[0]) : '') +
      (middle ? state.safe(middle, info) : '') +
      (encodeEnd ? encode(chars.at(-1)!) : '')
    )
  }
} satisfies Options['handlers']

const inlineMarkdown = unified().use(remarkStringify, { handlers }).use(remarkGfm)

export function flattenDocumentBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.flatMap((block) => (block.type === 'columns' ? block.columns.flatMap(flattenDocumentBlocks) : [block]))
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function listDepthOf(block: DocumentBlock): number | undefined {
  if (block.type === 'columns') return undefined
  return block.listDepth || block.bullet || undefined
}

function isItemStart(block: DocumentBlock): block is Exclude<DocumentBlock, { type: 'columns' }> & { bullet: number } {
  return block.type !== 'columns' && !!block.bullet
}

function serializedMarkdownLink(link: string | undefined): string {
  // documentToMarkdown drops every other target, so those links cannot keep runs apart.
  return link && /^(https?:|mailto:|#)/.test(link) ? link : ''
}

function sameMarkdownStyle(left: DocumentTextRun, right: DocumentTextRun): boolean {
  return (
    !!left.bold === !!right.bold &&
    !!left.italic === !!right.italic &&
    !!left.strike === !!right.strike &&
    serializedMarkdownLink(left.link) === serializedMarkdownLink(right.link)
  )
}

function styledPhrasing(value: string, run: DocumentTextRun): PhrasingContent {
  let node: PhrasingContent = { type: 'text', value }
  if (run.strike) node = { type: 'delete', children: [node] }
  if (run.italic) node = { type: 'emphasis', children: [node] }
  if (run.bold) node = { type: 'strong', children: [node] }
  const link = serializedMarkdownLink(run.link)
  if (link) node = { type: 'link', url: link, children: [node] }
  return node
}

function wrapperKey(node: PhrasingContent): string | undefined {
  if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete') return node.type
  if (node.type === 'link') return `link:${node.url}`
  return undefined
}

function mergePhrasing(nodes: PhrasingContent[]): PhrasingContent[] {
  const grouped: PhrasingContent[] = []
  for (const node of nodes) {
    const key = wrapperKey(node)
    const previous = grouped.at(-1)
    if (key && previous && wrapperKey(previous) === key && 'children' in previous && 'children' in node) {
      previous.children.push(...node.children)
      continue
    }
    grouped.push(node)
  }
  return grouped.map(mergeNode)
}

function mergeNode(node: PhrasingContent): PhrasingContent {
  if (!('children' in node)) return node
  return { ...node, children: mergePhrasing(node.children) }
}

function paragraphRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const pattern = /\r?\n[ \t]*\r?\n/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) ranges.push({ start: cursor, end: index })
    cursor = index + match[0].length
  }
  if (cursor < text.length) ranges.push({ start: cursor, end: text.length })
  return ranges
}

function runsToMarkdown(runs: DocumentTextRun[]): string {
  const merged = coalesceRuns(runs)
  let offset = 0
  const located = merged.map((run) => {
    const start = offset
    offset += run.text.length
    return { run, start, end: offset }
  })
  const paragraphs: string[] = []
  let runIndex = 0
  for (const { start, end } of paragraphRanges(merged.map((run) => run.text).join(''))) {
    while (runIndex < located.length && located[runIndex].end <= start) runIndex++
    const children: PhrasingContent[] = []
    for (let index = runIndex; index < located.length && located[index].start < end; index++) {
      const item = located[index]
      const from = Math.max(item.start, start)
      const to = Math.min(item.end, end)
      if (from >= to) continue
      const text = item.run.text.slice(from - item.start, to - item.start)
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
      if (!match) continue
      const [, lead, core, trail] = match
      if (lead) children.push({ type: 'text', value: lead })
      if (core) children.push(styledPhrasing(core, item.run))
      if (trail) children.push({ type: 'text', value: trail })
    }
    const phrasing = mergePhrasing(children)
    const edgeSpace = (node: PhrasingContent | undefined) => node?.type === 'text' && /^\s+$/.test(node.value)
    while (edgeSpace(phrasing[0])) phrasing.shift()
    while (edgeSpace(phrasing.at(-1))) phrasing.pop()
    if (!phrasing.length) continue
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: phrasing }] }
    paragraphs.push(String(inlineMarkdown.stringify(tree)).replace(/\n+$/, ''))
  }
  return paragraphs.join('\n\n')
}

function coalesceRuns(runs: DocumentTextRun[]): DocumentTextRun[] {
  const merged: DocumentTextRun[] = []
  for (const run of runs) {
    const previous = merged.at(-1)
    if (previous && sameMarkdownStyle(previous, run)) previous.text += run.text
    else merged.push({ ...run })
  }
  return merged
}

function blockCss(style: DocumentStyle | undefined): string {
  return [
    style?.align ? `text-align:${style.align}` : '',
    style?.before !== undefined ? `margin-top:${style.before}pt` : '',
    style?.after !== undefined ? `margin-bottom:${style.after}pt` : '',
    style?.indent ? `margin-left:${style.indent}pt` : '',
    style?.background ? `background:#${style.background}` : ''
  ]
    .filter(Boolean)
    .join(';')
}

interface ItemNode {
  depth: number
  orderedNumber?: number
  style?: DocumentStyle
  parts: Array<{ html: string } | { items: ItemNode[] }>
}

function itemsHtml(nodes: ItemNode[]): string {
  let html = ''
  let index = 0
  while (index < nodes.length) {
    const ordered = nodes[index].orderedNumber !== undefined
    let end = index + 1
    while (end < nodes.length && (nodes[end].orderedNumber !== undefined) === ordered) end++
    const group = nodes.slice(index, end)
    const tag = ordered ? 'ol' : 'ul'
    const start = ordered ? ` start="${group[0].orderedNumber}"` : ''
    const items = group
      .map((node) => {
        const value = ordered ? ` value="${node.orderedNumber}"` : ''
        const inner = node.parts.map((part) => ('html' in part ? part.html : itemsHtml(part.items))).join('')
        return `<li${value} style="${blockCss(node.style)}">${inner}</li>`
      })
      .join('')
    html += `<${tag}${start}>${items}</${tag}>`
    index = end
  }
  return html
}

function htmlRuns(runs: DocumentTextRun[]): string {
  return runs
    .map((run) => {
      const styles = [
        run.font ? `font-family:${escapeHtml(run.font)}` : '',
        run.size ? `font-size:${run.size}pt` : '',
        run.color ? `color:#${run.color}` : '',
        run.background ? `background-color:#${run.background}` : '',
        run.bold ? 'font-weight:bold' : '',
        run.italic ? 'font-style:italic' : '',
        run.underline || run.strike
          ? `text-decoration:${[run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].join(' ')}`
          : ''
      ].filter(Boolean)
      const text = `<span style="${styles.join(';')}">${escapeHtml(run.text).replaceAll('\n', '<br>')}</span>`
      return run.link && /^(?:https?:|mailto:|#)/.test(run.link)
        ? `<a href="${escapeHtml(run.link)}">${text}</a>`
        : text
    })
    .join('')
}

export function documentToHtml(
  blocks: DocumentBlock[],
  imageSource: (source: string) => string,
  title: string
): string {
  const blockHtml = (block: DocumentBlock, unwrapText: boolean): string => {
    if (block.type === 'columns') return ''
    if (block.type === 'image')
      return `<p><img src="${escapeHtml(imageSource(block.source))}" alt="${escapeHtml(block.text)}" style="max-width:100%;height:auto${block.width ? `;width:${block.width}px` : ''}"></p>`
    if (block.type === 'table')
      return `<table>${block.rows
        .map(
          (row, rowIndex) =>
            `<tr>${row
              .map((text, column) => {
                const cell = block.cells?.[rowIndex]?.[column]
                if (cell?.covered) return ''
                return `<td colspan="${cell?.colSpan ?? 1}" rowspan="${cell?.rowSpan ?? 1}" style="${cell?.background ? `background:#${cell.background};` : ''}${cell?.align ? `text-align:${cell.align};` : ''}">${htmlRuns(cell?.runs ?? [{ text }])}</td>`
              })
              .join('')}</tr>`
        )
        .join('')}</table>`
    const content = htmlRuns(block.runs ?? [{ text: block.text }])
    if (unwrapText && block.type === 'text') return content
    const tag = block.type === 'heading' ? `h${Math.min(6, block.level)}` : block.type === 'code' ? 'pre' : 'p'
    return `<${tag} style="${blockCss(block.style)}">${content}</${tag}>`
  }
  const renderList = (listBlocks: DocumentBlock[]): string => {
    const roots: ItemNode[] = []
    const stack: ItemNode[] = []
    let loose = ''
    const addItem = (item: ItemNode) => {
      while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) stack.pop()
      const parent = stack[stack.length - 1]
      if (!parent) roots.push(item)
      else {
        const last = parent.parts[parent.parts.length - 1]
        if (last && 'items' in last) last.items.push(item)
        else parent.parts.push({ items: [item] })
      }
      stack.push(item)
    }
    for (const block of listBlocks) {
      if (isItemStart(block)) {
        addItem({
          depth: block.bullet,
          orderedNumber: block.orderedNumber,
          style: 'style' in block ? block.style : undefined,
          parts: [{ html: blockHtml(block, true) }]
        })
        continue
      }
      const depth = listDepthOf(block) ?? 1
      while (stack.length > 0 && stack[stack.length - 1].depth > depth) stack.pop()
      const parent = stack[stack.length - 1]
      if (parent && parent.depth === depth) parent.parts.push({ html: blockHtml(block, false) })
      else loose += blockHtml(block, false)
    }
    return loose + itemsHtml(roots)
  }
  const render = (items: DocumentBlock[]): string => {
    const parts: string[] = []
    let index = 0
    while (index < items.length) {
      const block = items[index]
      if (block.type === 'columns') {
        parts.push(
          `<div style="display:flex;gap:16px">${block.columns.map((column, columnIndex) => `<div style="flex:${block.widths[columnIndex] || 1};min-width:0">${render(column)}</div>`).join('')}</div>`
        )
        index++
        continue
      }
      if (listDepthOf(block)) {
        const listBlocks: DocumentBlock[] = []
        while (index < items.length && items[index].type !== 'columns' && listDepthOf(items[index])) {
          listBlocks.push(items[index])
          index++
        }
        parts.push(renderList(listBlocks))
        continue
      }
      parts.push(blockHtml(block, false))
      index++
    }
    return parts.join('\n')
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#202020;line-height:1.5}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #b0b0b0;padding:6px;vertical-align:top}img{max-width:100%}pre{white-space:pre-wrap}p,h1,h2,h3,td{overflow-wrap:anywhere}@media print{body{margin:0}tr,img{break-inside:avoid}}</style></head><body>${render(blocks)}</body></html>`
}

function markdownDestination(value: string): string {
  return `<${value.replace(/[\\<>&]/g, '\\$&').replace(/\s/g, encodeURIComponent)}>`
}

export function documentToMarkdown(blocks: DocumentBlock[], imageSource: (source: string) => string): string {
  const text = (runs: DocumentTextRun[]) => runsToMarkdown(runs)
  const indentLines = (value: string, spaces: number) => {
    if (spaces <= 0) return value
    const pad = ' '.repeat(spaces)
    return value
      .split('\n')
      .map((line) => (line ? pad + line : line))
      .join('\n')
  }
  const withMarker = (value: string, baseIndent: number, marker: string, markerWidth: number) =>
    value
      .split('\n')
      .map((line, lineIndex) =>
        lineIndex === 0
          ? `${' '.repeat(baseIndent)}${marker} ${line}`
          : line
            ? `${' '.repeat(baseIndent + markerWidth)}${line}`
            : line
      )
      .join('\n')
  const bodyOf = (block: DocumentBlock) => {
    if (block.type === 'columns') return ''
    if (block.type === 'image')
      return `![${block.text.replace(/[[\]]/g, '')}](${markdownDestination(imageSource(block.source))})`
    if (block.type === 'table') {
      const rows = block.rows.map(
        (row, rowIndex) =>
          `| ${row
            .map((cell, column) => {
              const runs = block.cells?.[rowIndex]?.[column]?.runs
              return text(runs ?? [{ text: cell }])
                .trim()
                .replaceAll('\n', '<br>')
                .replaceAll('|', '\\|')
            })
            .join(' | ')} |`
      )
      if (rows.length) rows.splice(1, 0, `| ${block.rows[0].map(() => '---').join(' | ')} |`)
      return rows.join('\n')
    }
    if (block.type === 'code') {
      let fenceLength = 3
      for (const match of block.text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1)
      const fence = '`'.repeat(fenceLength)
      return `${fence}\n${block.text}${block.text.endsWith('\n') ? '' : '\n'}${fence}`
    }
    const content = text(block.runs ?? [{ text: block.text }]).trim()
    return block.type === 'heading' ? `${'#'.repeat(Math.min(6, block.level))} ${content}` : content
  }
  const ancestors: { depth: number; width: number }[] = []
  const rendered = flattenDocumentBlocks(blocks).map((block) => {
    const body = bodyOf(block)
    if (isItemStart(block)) {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= block.bullet) ancestors.pop()
      const indent = ancestors.reduce((total, ancestor) => total + ancestor.width, 0)
      const marker = block.orderedNumber !== undefined ? `${block.orderedNumber}.` : '-'
      const width = marker.length + 1
      ancestors.push({ depth: block.bullet, width })
      return { block, body, markdown: withMarker(body, indent, marker, width) }
    }
    const depth = listDepthOf(block)
    if (!depth) {
      ancestors.length = 0
      return { block, body, markdown: body }
    }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth > depth) ancestors.pop()
    const indent = ancestors.reduce((total, ancestor) => total + ancestor.width, 0)
    return { block, body, markdown: indentLines(body, indent) }
  })
  return (
    rendered
      .map((entry, index) => {
        if (!index) return entry.markdown
        const previous = rendered[index - 1]
        const tight =
          isItemStart(previous.block) &&
          !previous.body.trim() &&
          isItemStart(entry.block) &&
          entry.block.bullet > previous.block.bullet
        return `${tight ? '\n' : '\n\n'}${entry.markdown}`
      })
      .join('') + '\n'
  )
}
