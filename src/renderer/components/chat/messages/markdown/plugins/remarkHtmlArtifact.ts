import type { Code, Html, Root, RootContent } from 'mdast'
import remarkParse from 'remark-parse'
import type { Plugin } from 'unified'
import { unified } from 'unified'

const LEADING_HTML_METADATA_REGEX = /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>))*/i
const HTML_DOCUMENT_START_REGEX = /^<html(?:\s|>)/i
const HTML_DOCUMENT_END_REGEX = /<\/html\s*>/i
const HTML_LANGUAGE_REGEX = /^html?$/i
const PROTECTED_HTML_PLACEHOLDER_PREFIX = '__CHERRY_STUDIO_HTML_ARTIFACT_'
const LEADING_HTML_DOCTYPE_REGEX = /^(?:\s*(?:<!--[\s\S]*?-->|<\?[\s\S]*?\?>))*\s*<!doctype(?:\s|>)/i
// A *closed* opening tag, so a half-streamed `<div` never counts as a fragment.
const HTML_FRAGMENT_START_REGEX = /^<[a-z][a-z0-9-]*(?:\s[^>]*)?>/i

interface SourceRange {
  start: number
  end: number
}

function stripLeadingHtmlMetadata(value: string): string {
  return value.replace(LEADING_HTML_METADATA_REGEX, '').trimStart()
}

/**
 * A whole HTML document (rendered as source while streaming, then gated on safety) versus a
 * fragment embedded in prose (always rendered live in the script-less preview frame).
 */
export type HtmlArtifactKind = 'document' | 'fragment'

/**
 * Classifies a possibly-partial HTML source. Returns `undefined` while a streamed prefix is
 * still too short to tell — `<!doc` and `<di` are indistinguishable, and committing early
 * would swap the whole rendering surface a few characters later.
 */
export function classifyHtmlArtifactSource(value: string): HtmlArtifactKind | undefined {
  if (LEADING_HTML_DOCTYPE_REGEX.test(value)) return 'document'

  const content = stripLeadingHtmlMetadata(value)
  if (HTML_DOCUMENT_START_REGEX.test(content)) return 'document'

  return HTML_FRAGMENT_START_REGEX.test(content) ? 'fragment' : undefined
}

function isHtmlArtifact(node: Html): boolean {
  const content = stripLeadingHtmlMetadata(node.value)
  return content.length > 0 && !/^<svg[\s>]/i.test(content)
}

function isHtmlMetadataOnly(node: Html): boolean {
  return stripLeadingHtmlMetadata(node.value).length === 0
}

function isHtmlDocumentBoundary(node: Html): boolean {
  const content = stripLeadingHtmlMetadata(node.value)
  return HTML_DOCUMENT_START_REGEX.test(content) || HTML_DOCUMENT_END_REGEX.test(node.value)
}

function findHtmlDocumentEnd(children: readonly RootContent[], startIndex: number): number | undefined {
  let documentStartIndex = startIndex

  while (true) {
    const child = children[documentStartIndex]
    if (child?.type !== 'html' || !isHtmlMetadataOnly(child)) break
    documentStartIndex += 1
  }

  const documentStart = children[documentStartIndex]
  if (
    documentStart?.type !== 'html' ||
    !HTML_DOCUMENT_START_REGEX.test(stripLeadingHtmlMetadata(documentStart.value))
  ) {
    return undefined
  }

  for (let index = documentStartIndex; index < children.length; index += 1) {
    const child = children[index]
    if (child?.type === 'html' && HTML_DOCUMENT_END_REGEX.test(child.value)) return index
  }

  return undefined
}

function getSourceRange(nodes: readonly RootContent[]): SourceRange | undefined {
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const start = first?.position?.start.offset
  const end = last?.position?.end.offset
  return start !== undefined && end !== undefined ? { start, end } : undefined
}

function createHtmlDocumentCodeNode(nodes: readonly RootContent[], source: string): Code | undefined {
  const first = nodes[0]
  const last = nodes[nodes.length - 1] ?? first
  const range = getSourceRange(nodes)
  if (!first || !last || !range) return undefined

  const position =
    first.position && last.position ? { start: first.position.start, end: last.position.end } : first.position

  return {
    type: 'code',
    lang: 'html',
    value: source.slice(range.start, range.end),
    position
  }
}

function createHtmlCodeNode(node: Html): Code {
  return {
    type: 'code',
    lang: 'html',
    value: node.value,
    position: node.position
  }
}

function collectProtectedHtmlRanges(tree: Root): SourceRange[] {
  const ranges: SourceRange[] = []

  for (let index = 0; index < tree.children.length; index += 1) {
    const documentEndIndex = findHtmlDocumentEnd(tree.children, index)
    if (documentEndIndex !== undefined) {
      const range = getSourceRange(tree.children.slice(index, documentEndIndex + 1))
      if (range) ranges.push(range)
      index = documentEndIndex
      continue
    }

    const child = tree.children[index]
    const range = child ? getSourceRange([child]) : undefined
    if (!child || !range) continue

    if (child.type === 'code' && child.lang && HTML_LANGUAGE_REGEX.test(child.lang)) {
      ranges.push(range)
      continue
    }

    if (child.type === 'html' && isHtmlArtifact(child) && !isHtmlDocumentBoundary(child)) {
      ranges.push(range)
    }
  }

  return ranges
}

/**
 * Runs general Markdown preprocessing without changing the exact source of raw
 * or fenced HTML artifacts.
 */
export function transformMarkdownOutsideHtmlArtifacts(source: string, transform: (markdown: string) => string): string {
  if (!source.includes('<')) return transform(source)

  const processor = unified().use(remarkParse)
  const ranges = collectProtectedHtmlRanges(processor.parse(source))
  if (ranges.length === 0) return transform(source)

  let placeholderPrefix = PROTECTED_HTML_PLACEHOLDER_PREFIX
  while (source.includes(placeholderPrefix)) placeholderPrefix = `_${placeholderPrefix}`

  const protectedSources: string[] = []
  let cursor = 0
  let maskedSource = ''

  for (const range of ranges) {
    const index = protectedSources.length
    protectedSources.push(source.slice(range.start, range.end))
    maskedSource += `${source.slice(cursor, range.start)}${placeholderPrefix}${index}__`
    cursor = range.end
  }
  maskedSource += source.slice(cursor)

  let transformed = transform(maskedSource)
  protectedSources.forEach((protectedSource, index) => {
    transformed = transformed.replaceAll(`${placeholderPrefix}${index}__`, protectedSource)
  })
  return transformed
}

/**
 * Routes top-level raw HTML regions through the same renderer as fenced HTML.
 * Inline HTML stays in the Markdown tree so citations and text formatting keep
 * their existing behavior.
 */
export const remarkHtmlArtifact: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file)
  const children: RootContent[] = []

  for (let index = 0; index < tree.children.length; index += 1) {
    const documentEndIndex = findHtmlDocumentEnd(tree.children, index)
    if (documentEndIndex !== undefined) {
      const documentNodes = tree.children.slice(index, documentEndIndex + 1)
      const codeNode = createHtmlDocumentCodeNode(documentNodes, source)
      if (codeNode) {
        children.push(codeNode)
      } else {
        children.push(...documentNodes)
      }
      index = documentEndIndex
      continue
    }

    const child = tree.children[index]
    if (!child) continue
    children.push(
      child.type === 'html' && isHtmlArtifact(child) && !isHtmlDocumentBoundary(child)
        ? createHtmlCodeNode(child)
        : child
    )
  }

  tree.children = children
}
