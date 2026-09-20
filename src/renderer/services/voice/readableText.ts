import type { FormatCallback, SelectorDefinition } from 'html-to-text'
import { htmlToText } from 'html-to-text'
import type { PhrasingContent, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

export const READABLE_TEXT_CONFIRMATION_THRESHOLD = 5_000
export const SPEECH_ADAPTER_TEXT_LIMIT = 10_000
export const READABLE_TEXT_CHUNK_LIMIT = 4_000

export type ReadableTextMode = 'document' | 'selection'
export type ReadableTextTrigger = 'manual' | 'auto_read'

export type ReadableTextPlan =
  | { status: 'ready'; normalizedLength: number; chunks: string[] }
  | { status: 'confirmation_required'; normalizedLength: number; chunks: [] }
  | { status: 'skipped'; reason: 'too_long'; normalizedLength: number; chunks: [] }

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkLatexMath).freeze()

const skippedHtmlSelectors = [
  'code',
  'pre',
  'math',
  'script',
  'style',
  'template',
  'think',
  'reasoning',
  'tool-call',
  'tool-use',
  'tool-result',
  'terminal-output',
  'approval-prompt',
  'metadata',
  'attachment',
  'attachment-metadata',
  '[hidden]',
  '[aria-hidden="true"]',
  '[data-voice-skip]',
  '[data-type="reasoning"]',
  '[data-type="tool-call"]',
  '[data-type="tool_call"]',
  '[data-type="tool-result"]',
  '[data-type="tool_result"]',
  '[data-type="terminal-output"]',
  '[data-type="terminal_output"]',
  '[data-type="approval-prompt"]',
  '[data-type="approval_prompt"]',
  '[data-type="attachment"]',
  '[data-type="metadata"]'
]

const imageFormatter: FormatCallback = (element, _walk, builder) => {
  const alt = typeof element.attribs?.alt === 'string' ? element.attribs.alt : ''
  if (isMeaningfulImageAlt(alt)) builder.addInline(alt)
}

const htmlSelectors: SelectorDefinition[] = [
  ...skippedHtmlSelectors.map((selector) => ({ selector, format: 'skip' })),
  { selector: 'a', options: { ignoreHref: true } },
  { selector: 'img', format: 'meaningfulImage' },
  { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false, colSpacing: 1 } },
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
    selector,
    format: 'heading',
    options: { uppercase: false }
  }))
]

const genericImageAlts = new Set([
  'image',
  'img',
  'photo',
  'picture',
  'screenshot',
  'attachment',
  '图像',
  '图片',
  '截图'
])

function isMeaningfulImageAlt(value: string): boolean {
  const alt = normalizeWhitespace(value).toLowerCase()
  if (!alt) return false

  const isLocator = /^(?:[a-z][a-z\d+.-]*:\/\/|[/\\])|\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(alt)
  return !genericImageAlts.has(alt) && !isLocator
}

function toReadableHtmlText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: htmlSelectors,
    formatters: { meaningfulImage: imageFormatter }
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stripCitationMarkers(value: string): string {
  return value.replace(/([ \t]?)\[cite:[\w-]+\]/g, '')
}

function phrasingToHtml(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasingNodeToHtml).join('')
}

function phrasingNodeToHtml(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(stripCitationMarkers(node.value))
    case 'break':
      return '<br>'
    case 'image':
      return isMeaningfulImageAlt(node.alt ?? '') ? escapeHtml(node.alt ?? '') : ''
    case 'html':
      return node.value
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return phrasingToHtml(node.children)
    case 'inlineCode':
    case 'inlineMath':
    case 'imageReference':
    case 'footnoteReference':
      return ''
  }

  return ''
}

function phrasingToText(nodes: readonly PhrasingContent[]): string {
  return toReadableHtmlText(`<p>${phrasingToHtml(nodes)}</p>`)
}

function renderBlock(node: RootContent): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'tableCell':
      return phrasingToText(node.children)
    case 'blockquote':
    case 'listItem':
      return renderBlocks(node.children)
    case 'list':
      return node.children.map(renderBlock).filter(Boolean).join('\n')
    case 'table':
      return node.children.map(renderBlock).filter(Boolean).join('\n')
    case 'tableRow':
      return node.children.map(renderBlock).filter(Boolean).join(' ')
    case 'html':
      return toReadableHtmlText(node.value)
    case 'text':
    case 'break':
    case 'image':
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return phrasingToText([node])
    case 'code':
    case 'inlineCode':
    case 'math':
    case 'inlineMath':
    case 'definition':
    case 'footnoteDefinition':
    case 'footnoteReference':
    case 'imageReference':
    case 'thematicBreak':
    case 'yaml':
      return ''
  }

  return ''
}

function renderBlocks(nodes: readonly RootContent[]): string {
  return nodes.map(renderBlock).filter(Boolean).join('\n\n')
}

function normalizeWhitespace(value: string): string {
  const lines = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\r\n]+/g, ' ').trim())

  return lines
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([,.;:!?。！？；：])/g, '$1')
}

export function normalizeReadableText(input: string, options: { mode?: ReadableTextMode } = {}): string {
  if (options.mode === 'selection') return normalizeWhitespace(input)

  const tree = markdownParser.runSync(markdownParser.parse(input), input)
  return normalizeWhitespace(renderBlocks(tree.children))
}

function safeSliceEnd(text: string, start: number, maximumEnd: number): number {
  let end = Math.min(maximumEnd, text.length)
  const last = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)

  if (end > start && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1
  return end
}

function consumeWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  return index
}

function findChunkBoundary(text: string, start: number, end: number): { end: number; next: number } {
  const paragraph = text.lastIndexOf('\n\n', end - 1)
  if (paragraph >= start) return { end: paragraph, next: consumeWhitespace(text, paragraph + 2) }

  const line = text.lastIndexOf('\n', end - 1)
  if (line >= start) return { end: line, next: consumeWhitespace(text, line + 1) }

  for (let index = end - 1; index >= start; index -= 1) {
    if (/[.!?。！？；;]/.test(text[index]) && (index + 1 === text.length || /\s/.test(text[index + 1]))) {
      return { end: index + 1, next: consumeWhitespace(text, index + 1) }
    }
  }

  for (let index = end - 1; index >= start; index -= 1) {
    if (/\s/.test(text[index])) return { end: index, next: consumeWhitespace(text, index + 1) }
  }

  return { end, next: end }
}

export function chunkReadableText(text: string, requestedLimit = READABLE_TEXT_CHUNK_LIMIT): string[] {
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []

  const finiteLimit =
    Number.isFinite(requestedLimit) && requestedLimit >= 2 ? Math.floor(requestedLimit) : READABLE_TEXT_CHUNK_LIMIT
  const limit = Math.min(finiteLimit, SPEECH_ADAPTER_TEXT_LIMIT)
  const chunks: string[] = []
  let start = 0

  while (start < normalized.length) {
    const hardEnd = safeSliceEnd(normalized, start, start + limit)
    const boundary =
      hardEnd === normalized.length ? { end: hardEnd, next: hardEnd } : findChunkBoundary(normalized, start, hardEnd)
    const chunk = normalized.slice(start, boundary.end).trim()
    if (chunk) chunks.push(chunk)
    start = boundary.next > start ? boundary.next : hardEnd
  }

  return chunks
}

export function planReadableText(
  input: string,
  options: { trigger: ReadableTextTrigger; mode?: ReadableTextMode; confirmed?: boolean }
): ReadableTextPlan {
  const normalized = normalizeReadableText(input, { mode: options.mode })
  const normalizedLength = normalized.length

  if (normalizedLength > READABLE_TEXT_CONFIRMATION_THRESHOLD) {
    if (options.trigger === 'auto_read') {
      return { status: 'skipped', reason: 'too_long', normalizedLength, chunks: [] }
    }
    if (!options.confirmed) return { status: 'confirmation_required', normalizedLength, chunks: [] }
  }

  return { status: 'ready', normalizedLength, chunks: chunkReadableText(normalized) }
}
