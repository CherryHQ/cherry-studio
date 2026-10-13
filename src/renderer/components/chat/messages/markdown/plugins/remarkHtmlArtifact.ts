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
// Paired container boundaries wrapping Markdown stay raw HTML (#21456): CommonMark splits
// `<details>…</summary>` and `</details>` into two top-level html nodes around the body, and
// converting each into an artifact iframe shatters the native disclosure. Only the matched
// boundaries are exempt — the body keeps the normal processing; unpaired fragments keep the
// artifact preview path.
const HTML_CONTAINER_OPEN_REGEX = /^<details(?=[\s>])/i

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

function findHtmlDocumentEnd(
  children: readonly RootContent[],
  startIndex: number,
  end = children.length
): number | undefined {
  let documentStartIndex = startIndex

  while (true) {
    const child = children[documentStartIndex]
    if (child?.type !== 'html' || !isHtmlMetadataOnly(child)) break
    documentStartIndex += 1
  }

  const documentStart = children[documentStartIndex]
  if (
    documentStartIndex >= end ||
    documentStart?.type !== 'html' ||
    !HTML_DOCUMENT_START_REGEX.test(stripLeadingHtmlMetadata(documentStart.value))
  ) {
    return undefined
  }

  for (let index = documentStartIndex; index < end; index += 1) {
    const child = children[index]
    if (child?.type === 'html' && HTML_DOCUMENT_END_REGEX.test(child.value)) return index
  }

  return undefined
}

// Lexical scan for `<details` / `</details` boundaries: comments, raw-text element bodies
// (script/style/textarea/title) and ordinary tags are consumed whole, so a literal `</details>`
// inside them — script source, a comment, a quoted attribute — can never close a disclosure.
// A generic tag is consumed up to its first `>`; a quoted `>` before the tag ends is not valid
// HTML to begin with, and the quoted content is swallowed either way.
const CONTAINER_LEXICAL_TOKEN_REGEX =
  /<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?details(?=[\s>/])|<[a-z][^>]*?>/gi

interface ContainerScanResult {
  closed: boolean
  /** Offset just past the closing boundary's `>` when `closed`. */
  closeEnd?: number
}

// Walks every `<details` / `</details` boundary in `value`, keeping nesting depth; resolves to
// closed when a closing boundary brings the depth back to zero.
function scanContainerBoundaries(value: string, depth: { count: number }): ContainerScanResult {
  CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTAINER_LEXICAL_TOKEN_REGEX.exec(value)) !== null) {
    const token = match[0].toLowerCase()
    // Comments, raw-text bodies and ordinary tags are consumed without touching the depth —
    // only the details boundaries themselves open and close the disclosure.
    if (!token.startsWith('<details') && !token.startsWith('</details')) continue
    if (token[1] === '/') {
      depth.count -= 1
      if (depth.count === 0) {
        const tagEnd = value.indexOf('>', match.index)
        return { closed: true, closeEnd: tagEnd === -1 ? match.index + match[0].length : tagEnd + 1 }
      }
    } else {
      // A self-closing `<details … />` opens and closes itself.
      const tagEnd = value.indexOf('>', match.index)
      if (tagEnd === -1 || value[tagEnd - 1] !== '/') depth.count += 1
    }
  }
  return { closed: false }
}

interface PairedContainerClose {
  index: number
  /** The html node hosting the matched close, narrowed at the scan site. */
  closeNode: Html
  closeEnd: number
}

function findPairedContainerClose(
  children: readonly RootContent[],
  startIndex: number,
  end = children.length
): PairedContainerClose | undefined {
  const open = children[startIndex]
  if (open?.type !== 'html' || !HTML_CONTAINER_OPEN_REGEX.test(stripLeadingHtmlMetadata(open.value))) {
    return undefined
  }

  const depth = { count: 0 }
  // A disclosure completed inside its own node needs no pairing and keeps the artifact path.
  if (scanContainerBoundaries(open.value, depth).closed) return undefined
  for (let index = startIndex + 1; index < end; index += 1) {
    const child = children[index]
    if (child?.type !== 'html') continue
    const scan = scanContainerBoundaries(child.value, depth)
    if (scan.closed) return { index, closeNode: child, closeEnd: scan.closeEnd ?? child.value.length }
  }
  return undefined
}

// Splits an html node at value offsets. Offsets stay true to the source (the only position
// field consumers read); line/column of the sliced parts go stale.
function sliceHtmlNode(node: Html, start: number, end: number): Html {
  const position = node.position
  return {
    type: 'html',
    value: node.value.slice(start, end),
    position:
      position && position.start.offset !== undefined
        ? {
            start: { ...position.start, offset: position.start.offset + start },
            end: { ...position.start, offset: position.start.offset + end }
          }
        : position
  }
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

  const processRange = (items: RootContent[], from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const documentEndIndex = findHtmlDocumentEnd(items, index, to)
      if (documentEndIndex !== undefined) {
        const documentNodes = items.slice(index, documentEndIndex + 1)
        const codeNode = createHtmlDocumentCodeNode(documentNodes, source)
        if (codeNode) {
          children.push(codeNode)
        } else {
          children.push(...documentNodes)
        }
        index = documentEndIndex
        continue
      }

      const paired = findPairedContainerClose(items, index, to)
      if (paired !== undefined) {
        // Exempt only the matched boundaries; the body re-enters normal processing so nested
        // disclosures pair and inner artifacts/documents keep their existing paths.
        const openBoundary = items[index]
        const closeNode = paired.closeNode
        if (openBoundary) children.push(openBoundary)
        processRange(items, index + 1, paired.index)
        // The close can share its node with the NEXT disclosure's opening (`</details>` and
        // `<details>` merge into one html block when no blank line separates them): exempt only
        // the close itself and re-process the remainder as a fresh open, so the second
        // disclosure's own close never falls back to the artifact preview.
        if (paired.closeEnd < closeNode.value.length) {
          children.push(sliceHtmlNode(closeNode, 0, paired.closeEnd))
          // Leading whitespace on the remainder is insignificant inside the html block.
          const rest = closeNode.value.slice(paired.closeEnd)
          const remainderStart = paired.closeEnd + (rest.length - rest.trimStart().length)
          items.splice(paired.index, 1, sliceHtmlNode(closeNode, remainderStart, closeNode.value.length))
          index = paired.index - 1 // the loop increment lands on the remainder
        } else {
          children.push(closeNode)
          index = paired.index
        }
        continue
      }

      const child = items[index]
      if (!child) continue
      children.push(
        child.type === 'html' && isHtmlArtifact(child) && !isHtmlDocumentBoundary(child)
          ? createHtmlCodeNode(child)
          : child
      )
    }
  }

  processRange(tree.children, 0, tree.children.length)

  tree.children = children
}
