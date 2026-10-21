import type { FormatCallback, SelectorDefinition } from 'html-to-text'
import { htmlToText } from 'html-to-text'
import type { PhrasingContent, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

export const READABLE_TEXT_CONFIRMATION_THRESHOLD = 5_000
export const SPEECH_ADAPTER_TEXT_LIMIT = 10_000
export const READABLE_TEXT_CHUNK_LIMIT = 4_000

/**
 * Average delivery rates used to size a chunk from the text itself. Mandarin is
 * counted per character, English per word; punctuation contributes the pause a
 * listener actually hears, so a comma-heavy paragraph is split sooner.
 */
export const SPEECH_RATE = Object.freeze({
  hanCharsPerSecond: 4.5,
  latinWordsPerSecond: 2.8,
  clausePauseSeconds: 0.2,
  sentencePauseSeconds: 0.45
})

/** A chunk aims at roughly this much audio, not a fixed character count. */
export const SPEECH_CHUNK_TARGET_SECONDS = 35
export const MIN_SPEECH_CHUNK_CHARS = 120
export const MAX_SPEECH_CHUNK_CHARS = READABLE_TEXT_CHUNK_LIMIT

export type ReadableTextMode = 'document' | 'selection'
export type ReadableTextTrigger = 'manual' | 'auto_read'

export type ReadableTextPlan =
  | { status: 'ready'; normalizedLength: number; chunks: string[] }
  | { status: 'confirmation_required'; normalizedLength: number; chunks: [] }
  | { status: 'skipped'; reason: 'too_long'; normalizedLength: number; chunks: [] }

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkLatexMath)
  .use(remarkMath, { singleDollarTextMath: true })
  .freeze()

const skippedHtmlSelectors = [
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
  return value.replace(/([ \t]?)\[cite:(?=[^\]\n]*[\w-])[^\]\n]*\]/g, '')
}

function phrasingToHtml(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasingNodeToHtml).join('')
}

function phrasingNodeToHtml(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
      return escapeHtml(node.value)
    case 'break':
      return '<br>'
    case 'image':
    case 'imageReference':
      return `<img alt="${escapeHtml(node.alt ?? '')}">`
    case 'html':
      return node.value
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return phrasingToHtml(node.children)
    case 'inlineMath':
    case 'footnoteReference':
      return ''
  }

  return ''
}

function listItemToHtml(node: Extract<RootContent, { type: 'listItem' }>): string {
  const content = node.children
    .map((child) => (child.type === 'paragraph' ? phrasingToHtml(child.children) : blockToHtml(child)))
    .filter(Boolean)
    .join('<br>')
  return `<div>${content}</div>`
}

function blockToHtml(node: RootContent): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${phrasingToHtml(node.children)}</p>`
    case 'heading':
      return `<h${node.depth}>${phrasingToHtml(node.children)}</h${node.depth}>`
    case 'tableCell':
      return `<td>${phrasingToHtml(node.children)}</td>`
    case 'blockquote':
      return `<div>${blocksToHtml(node.children)}</div>`
    case 'listItem':
      return listItemToHtml(node)
    case 'list':
      return `<div>${node.children.map(listItemToHtml).join('')}</div>`
    case 'table':
      return `<table>${node.children.map(blockToHtml).join('')}</table>`
    case 'tableRow':
      return `<tr>${node.children.map(blockToHtml).join('')}</tr>`
    case 'html':
      return node.value
    case 'code':
      return `<pre><code>${escapeHtml(node.value)}</code></pre>`
    case 'text':
    case 'inlineCode':
    case 'break':
    case 'image':
    case 'emphasis':
    case 'strong':
    case 'delete':
    case 'link':
    case 'linkReference':
      return `<p>${phrasingToHtml([node])}</p>`
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

function blocksToHtml(nodes: readonly RootContent[]): string {
  return nodes.map(blockToHtml).join('\n')
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
  if (options.mode === 'selection') return normalizeWhitespace(stripCitationMarkers(input))

  const tree = markdownParser.runSync(markdownParser.parse(input), input)
  return normalizeWhitespace(stripCitationMarkers(toReadableHtmlText(blocksToHtml(tree.children))))
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
    const punctuation = text[index]
    const cjkBoundary = /[。！？；]/.test(punctuation)
    const spacedBoundary = /[.!?;]/.test(punctuation) && (index + 1 === text.length || /\s/.test(text[index + 1]))
    if (cjkBoundary || spacedBoundary) {
      return { end: index + 1, next: consumeWhitespace(text, index + 1) }
    }
  }

  for (let index = end - 1; index >= start; index -= 1) {
    if (/\s/.test(text[index])) return { end: index, next: consumeWhitespace(text, index + 1) }
  }

  return { end, next: end }
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

/** Estimated wall-clock duration of the text at normal reading speed. */
export function estimateSpeechSeconds(text: string): number {
  const han = countMatches(text, /\p{Script=Han}/gu)
  const latinWords = countMatches(text, /[A-Za-z]+(?:['’-][A-Za-z]+)*/g)
  const clauses = countMatches(text, /[，,、;；:：]/g)
  const sentences = countMatches(text, /[。！？!?]|\.(?=\s|$)/g)
  return (
    han / SPEECH_RATE.hanCharsPerSecond +
    latinWords / SPEECH_RATE.latinWordsPerSecond +
    clauses * SPEECH_RATE.clausePauseSeconds +
    sentences * SPEECH_RATE.sentencePauseSeconds
  )
}

/**
 * Character budget for one chunk, derived from how long this particular text
 * takes to speak. A 35-second target gives Chinese roughly 160 characters and
 * English roughly 500, instead of one fixed number for both.
 */
export function computeSpeechChunkLimit(text: string, targetSeconds = SPEECH_CHUNK_TARGET_SECONDS): number {
  const characters = text.trim().length
  if (characters === 0) return 0
  const seconds = estimateSpeechSeconds(text)
  if (seconds <= targetSeconds) return Math.min(MAX_SPEECH_CHUNK_CHARS, characters)
  const limit = Math.round((characters / seconds) * targetSeconds)
  return Math.min(MAX_SPEECH_CHUNK_CHARS, Math.max(MIN_SPEECH_CHUNK_CHARS, limit))
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

  return {
    status: 'ready',
    normalizedLength,
    chunks: chunkReadableText(normalized, computeSpeechChunkLimit(normalized))
  }
}

/** Retain the last Markdown block; only plain prose can commit at sentence boundaries. */
export function stableReadableTextEnd(input: string): number {
  const tree = markdownParser.parse(input)
  const last = tree.children.at(-1)
  if (!last) return 0
  const start = last.position?.start.offset ?? 0
  if (last.type !== 'paragraph' || last.children.some((node) => node.type !== 'text')) return start
  const tail = input.slice(start)
  if (/[[\]`*_~<>$\\]/u.test(tail)) return start
  let end = start
  for (const match of tail.matchAll(/[。！？；]|[.!?;](?=\s)/gu)) end = start + match.index + match[0].length
  return end
}
