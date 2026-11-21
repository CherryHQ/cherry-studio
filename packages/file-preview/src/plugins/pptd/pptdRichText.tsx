/**
 * PPTD rich text rendering: the upstream reference's tag subset
 * (p/span/strong/em/u/s/sup/sub/a/ul/ol/li/br), paragraph and inline style
 * attributes, plain-text shorthand, and \(...\) LaTeX formulas via KaTeX.
 * Style priority: semantic tags > span styles > paragraph styles > content
 * fields > referenced theme text style > defaults.
 */
import katex from 'katex'
import type { CSSProperties, ReactNode } from 'react'
import { createElement, Fragment } from 'react'

import type { PptdAlignment, PptdFontFamily, PptdTextContent, PptdTextStyleConfig } from './pptdFormat'
import { pptdColorToCss, type PptdStyleContext } from './pptdStyle'

export interface ResolvedPptdTextStyle {
  color?: string
  backgroundColor?: string
  fontSize: number
  fontFamily?: PptdFontFamily
  bold: boolean
  italic: boolean
  lineHeight?: number
  lineHeightPx?: number
  letterSpacing: number
  marginTop: number
}

const TEXT_STYLE_DEFAULTS: ResolvedPptdTextStyle = {
  // The slide surface defaults to white, so text must default to the format's
  // black: inheriting the host app's foreground turns pale in dark mode.
  color: '#000000',
  fontSize: 18,
  fontFamily: 'MiSans',
  bold: false,
  italic: false,
  lineHeight: 1,
  letterSpacing: 0,
  marginTop: 0
}

/** Resolves the content-level style: defaults < theme text style < content fields. */
export function resolvePptdTextStyle(content: PptdTextContent, context: PptdStyleContext): ResolvedPptdTextStyle {
  const themeStyle: PptdTextStyleConfig | undefined = content.style?.startsWith('$')
    ? context.theme?.textStyles?.[content.style.slice(1)]
    : undefined
  const merged: ResolvedPptdTextStyle = { ...TEXT_STYLE_DEFAULTS }
  for (const source of [themeStyle, content] as const) {
    if (!source) continue
    if (source.color !== undefined) merged.color = source.color
    if (source.backgroundColor !== undefined) merged.backgroundColor = source.backgroundColor
    if (source.fontSize !== undefined) merged.fontSize = source.fontSize
    if (source.fontFamily !== undefined) merged.fontFamily = source.fontFamily
    if (source.bold !== undefined) merged.bold = source.bold
    if (source.italic !== undefined) merged.italic = source.italic
    if (source.lineHeight !== undefined) merged.lineHeight = source.lineHeight
    if (source.lineHeightPx !== undefined) merged.lineHeightPx = source.lineHeightPx
    if (source.letterSpacing !== undefined) merged.letterSpacing = source.letterSpacing
    if (source.marginTop !== undefined) merged.marginTop = source.marginTop
  }
  return merged
}

export function pptdFontFamilyCss(family: PptdFontFamily | undefined): string | undefined {
  if (!family) return undefined
  if (typeof family === 'string') return family
  return `${family.latin}, ${family.ea}`
}

export function pptdTextStyleCss(style: ResolvedPptdTextStyle, context: PptdStyleContext): CSSProperties {
  const css: CSSProperties = {
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    letterSpacing: style.letterSpacing !== 0 ? style.letterSpacing : undefined
  }
  const family = pptdFontFamilyCss(style.fontFamily)
  if (family) css.fontFamily = family
  const color = pptdColorToCss(style.color, context)
  if (color) css.color = color
  const background = pptdColorToCss(style.backgroundColor, context)
  if (background) css.backgroundColor = background
  if (style.lineHeightPx !== undefined) {
    css.lineHeight = `${style.lineHeightPx}px`
  } else if (style.lineHeight !== undefined) {
    css.lineHeight = style.lineHeight
  }
  return css
}

/** Splits raw text into plain segments and \(...\) formula segments. */
export function splitPptdMathSegments(text: string): Array<{ kind: 'text' | 'math'; value: string }> {
  const segments: Array<{ kind: 'text' | 'math'; value: string }> = []
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf('\\(', cursor)
    if (open === -1) {
      segments.push({ kind: 'text', value: text.slice(cursor) })
      break
    }
    if (open > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, open) })
    }
    const close = text.indexOf('\\)', open + 2)
    if (close === -1) {
      // Unterminated formula: render the rest as source text.
      segments.push({ kind: 'text', value: text.slice(open) })
      break
    }
    segments.push({ kind: 'math', value: text.slice(open + 2, close) })
    cursor = close + 2
  }
  return segments
}

function renderMathSegment(formula: string, key: string): ReactNode {
  try {
    const html = katex.renderToString(formula, { throwOnError: true, output: 'html' })
    return createElement('span', { key, className: 'pptd-math', dangerouslySetInnerHTML: { __html: html } })
  } catch {
    // AC3: invalid formula input shows the source text with an error marker.
    return createElement(
      'span',
      {
        key,
        className: 'pptd-math-error',
        title: 'Invalid formula',
        style: { color: '#B91C1C', textDecoration: 'underline dotted' }
      },
      `\\(${formula}\\)`
    )
  }
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  return splitPptdMathSegments(text).map((segment, index) =>
    segment.kind === 'math' ? (
      renderMathSegment(segment.value, `${keyPrefix}-m${index}`)
    ) : (
      <Fragment key={`${keyPrefix}-t${index}`}>{segment.value}</Fragment>
    )
  )
}

/** Parses the style attribute of a span into CSS, resolving theme color references. */
function spanStyleCss(styleAttr: string | null, context: PptdStyleContext): CSSProperties {
  const css: CSSProperties = {}
  if (!styleAttr) return css
  for (const declaration of styleAttr.split(';')) {
    const [rawProperty, ...rawValue] = declaration.split(':')
    const property = rawProperty?.trim().toLowerCase()
    const value = rawValue.join(':').trim()
    if (!property || !value) continue
    switch (property) {
      case 'color': {
        const color = pptdColorToCss(value, context)
        if (color) css.color = color
        break
      }
      case 'background-color': {
        const color = pptdColorToCss(value, context)
        if (color) css.backgroundColor = color
        break
      }
      case 'font-size': {
        const size = parseFloat(value)
        if (Number.isFinite(size)) css.fontSize = size
        break
      }
      case 'font-family':
        css.fontFamily = value.replace(/^["']|["']$/g, '')
        break
    }
  }
  return css
}

/** Paragraph-level style attribute (only <p> supports these per the reference). */
function paragraphStyleCss(styleAttr: string | null): CSSProperties {
  const css: CSSProperties = {}
  if (!styleAttr) return css
  for (const declaration of styleAttr.split(';')) {
    const [rawProperty, ...rawValue] = declaration.split(':')
    const property = rawProperty?.trim().toLowerCase()
    const value = rawValue.join(':').trim()
    if (!property || !value) continue
    switch (property) {
      case 'text-align':
        if (['left', 'center', 'right', 'justify'].includes(value)) css.textAlign = value as CSSProperties['textAlign']
        break
      case 'line-height': {
        if (value.endsWith('px')) {
          css.lineHeight = value
        } else {
          const multiple = parseFloat(value)
          if (Number.isFinite(multiple)) css.lineHeight = multiple
        }
        break
      }
      case 'margin-top':
      case 'margin-left':
      case 'margin-right': {
        const size = parseFloat(value)
        if (!Number.isFinite(size)) break
        if (property === 'margin-top') css.marginTop = size
        if (property === 'margin-left') css.marginLeft = size
        if (property === 'margin-right') css.marginRight = size
        break
      }
    }
  }
  return css
}

const INLINE_TAGS: Record<string, string> = {
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'u',
  s: 's',
  sup: 'sup',
  sub: 'sub',
  span: 'span'
}

function renderInlineNode(node: ChildNode, context: PptdStyleContext, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return renderInlineText(node.textContent ?? '', key)
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }
  const element = node as Element
  const tag = element.tagName.toLowerCase()
  const children = Array.from(element.childNodes).map((child, index) =>
    renderInlineNode(child, context, `${key}-${index}`)
  )

  if (tag === 'br') {
    return <br key={key} />
  }
  if (tag === 'a') {
    const href = element.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) {
      return (
        <a key={key} style={{ color: '#2563EB', textDecoration: 'underline' }}>
          {children}
        </a>
      )
    }
    return <Fragment key={key}>{children}</Fragment>
  }
  const mapped = INLINE_TAGS[tag]
  if (mapped) {
    const style = tag === 'span' ? spanStyleCss(element.getAttribute('style'), context) : undefined
    return createElement(mapped, { key, style }, children)
  }
  // Unknown inline markup degrades to its text content rather than disappearing.
  return <Fragment key={key}>{children}</Fragment>
}

function renderList(element: Element, context: PptdStyleContext, key: string): ReactNode {
  const tag = element.tagName.toLowerCase() === 'ol' ? 'ol' : 'ul'
  const items = Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((item, index) => {
      const style = paragraphStyleCss(item.getAttribute('style'))
      return createElement(
        'li',
        { key: `${key}-${index}`, style },
        Array.from(item.childNodes).map((child, childIndex) =>
          renderInlineNode(child, context, `${key}-${index}-${childIndex}`)
        )
      )
    })
  return createElement(tag, { key, style: { margin: 0, paddingLeft: '1.2em' } }, items)
}

/** Tags the upstream reference defines; only their presence marks text as rich text. */
const RICH_TEXT_TAG_PATTERN = /<\/?(p|span|strong|em|u|s|sup|sub|a|ul|ol|li|br)([\s/>]|$)/i

/** Normalizes the plain-text shorthand into paragraph HTML per the reference. */
export function normalizePptdRichText(text: string): string {
  if (RICH_TEXT_TAG_PATTERN.test(text)) {
    return text
  }
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeRichTextLinePreservingMath(line)}</p>`)
    .join('')
}

function escapeRichTextLine(line: string): string {
  return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRichTextLinePreservingMath(line: string): string {
  return splitPptdMathSegments(line)
    .map((segment) => (segment.kind === 'math' ? `\\(${segment.value}\\)` : escapeRichTextLine(segment.value)))
    .join('')
}

export interface PptdRichTextOptions {
  context: PptdStyleContext
  align?: PptdAlignment
}

/** Renders TextContent.text into block-level React nodes. */
export function renderPptdRichText(text: string, options: PptdRichTextOptions): ReactNode {
  const html = normalizePptdRichText(text)
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks: ReactNode[] = []
  Array.from(parsed.body.childNodes).forEach((node, index) => {
    const key = `b${index}`
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ''
      if (value.trim().length === 0) return
      blocks.push(<p key={key}>{renderInlineText(value, key)}</p>)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (tag === 'p') {
      const style = paragraphStyleCss(element.getAttribute('style'))
      blocks.push(
        createElement(
          'p',
          { key, style: { margin: 0, ...style } },
          Array.from(element.childNodes).map((child, childIndex) =>
            renderInlineNode(child, options.context, `${key}-${childIndex}`)
          )
        )
      )
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      blocks.push(renderList(element, options.context, key))
      return
    }
    // Unknown block markup degrades to inline content inside a paragraph.
    blocks.push(
      createElement(
        'p',
        { key, style: { margin: 0 } },
        Array.from(element.childNodes).map((child, childIndex) =>
          renderInlineNode(child, options.context, `${key}-${childIndex}`)
        )
      )
    )
  })
  return blocks
}

/** Horizontal alignment for the text container (paragraph default from content.align). */
export function pptdTextAlignCss(align: PptdAlignment | undefined): Pick<CSSProperties, 'textAlign'> {
  const horizontal = align?.[0] ?? 'left'
  return { textAlign: horizontal === 'distributed' ? 'justify' : horizontal }
}
