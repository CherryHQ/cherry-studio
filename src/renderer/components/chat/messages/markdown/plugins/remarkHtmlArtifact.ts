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

// HTML raw-text elements: everything up to the matching end tag is literal text (script/style
// are raw text, textarea/title RCDATA, iframe/xmp/noembed/noframes use the raw-text algorithm),
// so a literal `</details>` inside them — script source, textarea fallback, noembed fallback —
// can never close a disclosure. `plaintext` is special: it has NO end tag at all, its body runs
// to end-of-input, so nothing after it is ever a boundary.
const RAW_TEXT_ELEMENT_NAMES = [
  'script',
  'style',
  'textarea',
  'title',
  'iframe',
  'xmp',
  'noembed',
  'noframes',
  'plaintext'
]
// A raw-text body opened in one html node can continue into the following nodes (a blank line
// splits html blocks), so the end tag is located with the same per-element pattern the
// same-node token match uses. The `g` flag is load-bearing: the cross-node scan positions the
// search with `lastIndex`, and without `g` a regex ignores it — finding an EARLIER element's
// close, moving the cursor backward, and looping forever on consecutive raw-text elements
// whose second close has not arrived yet.
const RAW_TEXT_CLOSE_REGEXES = new Map(RAW_TEXT_ELEMENT_NAMES.map((name) => [name, new RegExp(`</${name}\\s*>`, 'gi')]))
// Lexical scan for `<details` / `</details` boundaries: comments, raw-text element bodies and
// ordinary tags are consumed whole, so a literal `</details>` inside them — a comment, a quoted
// attribute — can never close a disclosure. Disclosure tags consume their full attribute list
// (`title="</details>"` is legal HTML whose decoy must not reach the depth counter); a generic
// tag does the same so a quoted `>` never ends the tag early.
const CONTAINER_LEXICAL_TOKEN_REGEX = new RegExp(
  `<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<(${RAW_TEXT_ELEMENT_NAMES.join('|')})\\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\\s\\S]*?<\\/\\1\\s*>|<\\/?details(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<[a-z](?:"[^"]*"|'[^']*'|[^>"'])*>`,
  'gi'
)

/**
 * Lexical position carried across the html nodes of one pairing search: the open `<details>`
 * depth, a raw-text element whose body has not seen its end tag yet, an unterminated `<!--`
 * comment swallowing input until its `-->`, and a tag whose quoted attribute list is still
 * open (everything up to its `>` is tag interior, so a literal `</details>` inside the value
 * is attribute text, never a boundary).
 */
interface ContainerScanState {
  count: number
  rawText?: string
  inComment?: boolean
  inTag?: boolean
  pendingQuote?: string
  inCDATA?: boolean
  pendingRawText?: string
}

interface ContainerScanResult {
  closed: boolean
  /** Offset of the closing boundary's `<` when `closed`. */
  closeStart?: number
  /** Offset just past the closing boundary's `>` when `closed`. */
  closeEnd?: number
}

// Detects a tag OPENer (`<div`, `<details`, …) — close tags (`</div>`) are complete by
// construction and skipped by the token scan, so only open tags can dangle unterminated.
const TAG_OPENER_REGEX = /<[a-zA-Z]/g

// A tag opener whose alternatives all failed is unterminated: locate the `>` that actually
// completes it, honoring quoted attribute values (a `</details>` inside the quotes is value
// text). Returns undefined when the tag does not complete in `value` — `state.pendingQuote`
// then carries the quote the continuation node must close first. Quote positions use a -1
// sentinel (never undefined), so "no quote found" cannot be confused with index arithmetic.
function findUnfinishedTagEnd(value: string, from: number, state: ContainerScanState): number | undefined {
  let cursor = from
  while (cursor < value.length) {
    if (state.pendingQuote !== undefined) {
      const close = value.indexOf(state.pendingQuote, cursor)
      if (close === -1) return undefined
      cursor = close + 1
      state.pendingQuote = undefined
      continue
    }
    const gt = value.indexOf('>', cursor)
    const doubleQuote = value.indexOf('"', cursor)
    const singleQuote = value.indexOf("'", cursor)
    const quote =
      doubleQuote === -1 ? singleQuote : singleQuote === -1 ? doubleQuote : Math.min(doubleQuote, singleQuote)
    if (gt === -1) {
      if (quote !== -1) state.pendingQuote = value[quote]
      return undefined
    }
    if (quote === -1 || quote > gt) return gt
    const closeQuote = value.indexOf(value[quote], quote + 1)
    if (closeQuote === -1) {
      state.pendingQuote = value[quote]
      return undefined
    }
    cursor = closeQuote + 1
  }
  return undefined
}

// Walks every `<details` / `</details` boundary in `value`, continuing the state carried over
// from the previous nodes; resolves to closed when a closing boundary brings the depth back to
// zero.
function scanContainerBoundaries(value: string, state: ContainerScanState): ContainerScanResult {
  let position = 0
  while (position < value.length) {
    // An unterminated comment keeps swallowing content — across later nodes — until its `-->`.
    if (state.inComment) {
      const end = value.indexOf('-->', position)
      if (end === -1) return { closed: false }
      position = end + 3
      state.inComment = false
      continue
    }

    // A raw-text body opened earlier keeps swallowing content — across the blank lines that
    // split html blocks — until its end tag shows up; nothing else matches inside it. The
    // state survives every continuation node: only the matching end tag ends the body.
    // `<plaintext>` has no end tag: its body runs to end-of-input, so every later boundary
    // candidate is body text.
    if (state.rawText !== undefined) {
      if (state.rawText === 'plaintext') return { closed: false }
      const closeRegex = RAW_TEXT_CLOSE_REGEXES.get(state.rawText)
      if (!closeRegex) {
        state.rawText = undefined
        continue
      }
      closeRegex.lastIndex = position
      const close = closeRegex.exec(value)
      if (!close) return { closed: false }
      position = close.index + close[0].length
      state.rawText = undefined
      continue
    }

    // An unfinished tag opened in an earlier node keeps swallowing content until its real `>`
    // (quoted values first); a literal `</details>` inside it is attribute value text. When
    // the tag completes, remember whether it opens a raw-text body.
    if (state.inTag) {
      const end = findUnfinishedTagEnd(value, 0, state)
      if (end === undefined) return { closed: false }
      position = end + 1
      state.inTag = false
      if (state.pendingRawText !== undefined) {
        state.rawText = state.pendingRawText
        state.pendingRawText = undefined
      }
      continue
    }

    // An unterminated CDATA section keeps swallowing content — across later nodes — until
    // its `]]>`; foreign-content text inside it is never a disclosure boundary.
    if (state.inCDATA) {
      const end = value.indexOf(']]>', position)
      if (end === -1) return { closed: false }
      position = end + 3
      state.inCDATA = false
      continue
    }

    CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = position
    const match = CONTAINER_LEXICAL_TOKEN_REGEX.exec(value)
    // A comment opening before the next token cannot terminate in the remaining input (a
    // complete comment would have matched as the token itself): it swallows the rest of the
    // input — across later nodes — so no boundary inside it may be trusted.
    const commentStart = value.indexOf('<!--', position)
    const cdataStart = value.indexOf('<![CDATA[', position)
    // Same detection for a tag opener that precedes the first complete token: the token
    // alternatives match ANY complete tag at its own position, so an opener earlier than the
    // first match never completes in this node — its attribute text may hide boundaries.
    TAG_OPENER_REGEX.lastIndex = position
    const opener = TAG_OPENER_REGEX.exec(value)
    const tagStart = opener?.index
    const tagFirst =
      tagStart !== undefined &&
      (match === null || tagStart < match.index) &&
      (commentStart === -1 || tagStart < commentStart) &&
      (cdataStart === -1 || tagStart < cdataStart)
    if (tagFirst) {
      state.inTag = true
      // A raw-text element whose attribute list dangles into later nodes opens its raw-text
      // body the moment the tag completes — remember the element name for that transition.
      const tagName = /^<([a-z][a-z0-9-]*)/i.exec(value.slice(tagStart))?.[1]?.toLowerCase()
      if (tagName !== undefined && RAW_TEXT_CLOSE_REGEXES.has(tagName)) state.pendingRawText = tagName
      const end = findUnfinishedTagEnd(value, tagStart + 1, state)
      if (end === undefined) return { closed: false }
      position = end + 1
      state.inTag = false
      if (state.pendingRawText !== undefined) {
        state.rawText = state.pendingRawText
        state.pendingRawText = undefined
      }
      continue
    }
    const cdataFirst =
      cdataStart !== -1 &&
      (match === null || cdataStart < match.index) &&
      (commentStart === -1 || cdataStart < commentStart)
    if (cdataFirst) {
      state.inCDATA = true
      return { closed: false }
    }
    if (commentStart !== -1 && (match === null || commentStart < match.index)) {
      state.inComment = true
      return { closed: false }
    }
    if (!match) return { closed: false }
    position = match.index + match[0].length

    // A same-node raw-text element consumed its whole body including the end tag.
    if (match[1] !== undefined) continue

    const token = match[0].toLowerCase()
    // Comments, raw-text bodies and ordinary tags are consumed without touching the depth —
    // only the details boundaries themselves open and close the disclosure. A generic match on
    // a raw-text open means its end tag is not in this node: the body continues in later nodes.
    if (!token.startsWith('<details') && !token.startsWith('</details')) {
      const name = /^<([a-z][a-z0-9-]*)/.exec(token)?.[1]
      if (name !== undefined && RAW_TEXT_CLOSE_REGEXES.has(name)) state.rawText = name
      continue
    }
    if (token[1] === '/') {
      state.count -= 1
      if (state.count === 0) {
        // The token consumed the complete end tag, quotes included.
        return { closed: true, closeStart: match.index, closeEnd: match.index + match[0].length }
      }
    } else {
      // A self-closing `<details … />` opens and closes itself. The token carries the complete
      // tag, so this reads the real tag end instead of a `>` inside a quoted attribute.
      if (!match[0].endsWith('/>')) state.count += 1
    }
  }
  return { closed: false }
}

// First `</details>` boundary not matched by an opening inside the same node — i.e. one that
// closes a boundary retained in an enclosing shared opening node. Comments (an unfinished one
// swallows the rest of the node), raw-text bodies and quoted attributes are skipped exactly
// like in the pairing scan.
function findUnmatchedDetailsClose(value: string): { start: number; end: number } | undefined {
  let depth = 0
  let scanned = 0
  CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONTAINER_LEXICAL_TOKEN_REGEX.exec(value)) !== null) {
    const commentStart = value.indexOf('<!--', scanned)
    if (commentStart !== -1 && commentStart < match.index) {
      return undefined // an unfinished comment opens before the boundary and never terminates
    }
    scanned = match.index + match[0].length
    if (match[1] !== undefined) continue // a same-node raw-text body holds no real boundary
    const token = match[0].toLowerCase()
    if (!token.startsWith('<details') && !token.startsWith('</details')) continue
    if (token[1] === '/') {
      if (depth === 0) return { start: match.index, end: match.index + match[0].length }
      depth -= 1
    } else if (!match[0].endsWith('/>')) {
      depth += 1
    }
  }
  return undefined
}

interface PairedContainerClose {
  index: number
  /** The html node hosting the matched close, narrowed at the scan site. */
  closeNode: Html
  closeStart: number
  closeEnd: number
  /** Open boundaries still awaiting a close once the opening node ends. */
  retainedOpens: number
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

  const state: ContainerScanState = { count: 0 }
  // A disclosure completed inside its own node needs no pairing and keeps the artifact path.
  if (scanContainerBoundaries(open.value, state).closed) return undefined
  // Adjacent opening lines without a blank line merge into ONE html node: every open still
  // awaiting a close after this node must receive its close from inside the paired body.
  const retainedOpens = state.count
  for (let index = startIndex + 1; index < end; index += 1) {
    const child = children[index]
    if (child?.type !== 'html') continue
    const scan = scanContainerBoundaries(child.value, state)
    if (scan.closed) {
      return {
        index,
        closeNode: child,
        closeStart: scan.closeStart ?? 0,
        closeEnd: scan.closeEnd ?? child.value.length,
        retainedOpens
      }
    }
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

  // `retainedOpens` counts disclosures opened by a shared opening node outside this range —
  // the range must keep their closes raw instead of letting them become code.
  const processRange = (items: RootContent[], from: number, to: number, retainedOpens: number): void => {
    let pendingCloses = retainedOpens
    // Lexical state for resolving retained closes across the body's html nodes (depth 1 means
    // "the next unmatched close is the retained one"; re-armed after each resolution).
    const pendingScanState: ContainerScanState = { count: 1 }
    for (let index = from; index < to; index += 1) {
      const documentEndIndex = findHtmlDocumentEnd(items, index, to)
      if (documentEndIndex !== undefined) {
        let documentNodes = items.slice(index, documentEndIndex + 1)
        let resumeIndex = documentEndIndex
        // A document tail sharing its node with the closes owed to retained openings (a shared
        // opening node's `</details>` merged after `</html>`) must not be swallowed into the
        // artifact: split the tail off so the pending-close path below can keep those closes
        // raw.
        if (pendingCloses > 0) {
          const last = items[documentEndIndex]
          if (last?.type === 'html') {
            const htmlEndMatch = HTML_DOCUMENT_END_REGEX.exec(last.value)
            const htmlEnd = htmlEndMatch ? htmlEndMatch.index + htmlEndMatch[0].length : last.value.length
            const tail = last.value.slice(htmlEnd)
            if (htmlEnd < last.value.length && findUnmatchedDetailsClose(tail) !== undefined) {
              documentNodes = [...items.slice(index, documentEndIndex), sliceHtmlNode(last, 0, htmlEnd)]
              items.splice(documentEndIndex, 1, sliceHtmlNode(last, htmlEnd, last.value.length))
              resumeIndex = documentEndIndex - 1 // the loop increment lands on the tail node
            }
          }
        }
        const codeNode = createHtmlDocumentCodeNode(documentNodes, source)
        if (codeNode) {
          children.push(codeNode)
        } else {
          children.push(...documentNodes)
        }
        index = resumeIndex
        continue
      }

      const paired = findPairedContainerClose(items, index, to)
      if (paired !== undefined) {
        // Exempt only the matched boundaries; the body re-enters normal processing so nested
        // disclosures pair and inner artifacts/documents keep their existing paths.
        const openBoundary = items[index]
        const closeNode = paired.closeNode
        if (openBoundary) children.push(openBoundary)
        // Content preceding the boundary inside its own node joins the SAME body range, so a
        // multi-node document ending right before the close still assembles one artifact —
        // processing it as a separate single-node range would lose the document start.
        const body: RootContent[] = items.slice(index + 1, paired.index)
        if (paired.closeStart > 0) body.push(sliceHtmlNode(closeNode, 0, paired.closeStart))
        // The paired close closes the outermost opening of the opening node; every opening
        // retained next to it has no matching open inside the body, so its close arrives as an
        // unpaired body node and must stay raw (see the fallback below).
        processRange(body, 0, body.length, Math.max(paired.retainedOpens - 1, 0))
        children.push(sliceHtmlNode(closeNode, paired.closeStart, paired.closeEnd))
        if (paired.closeEnd < closeNode.value.length) {
          // The NEXT disclosure's opening after the boundary (`</details>` and `<details>`
          // merge into one html block when no blank line separates them) re-enters pairing as
          // a fresh open. Leading whitespace on the remainder is insignificant inside the
          // html block.
          const rest = closeNode.value.slice(paired.closeEnd)
          const remainderStart = paired.closeEnd + (rest.length - rest.trimStart().length)
          items.splice(paired.index, 1, sliceHtmlNode(closeNode, remainderStart, closeNode.value.length))
          index = paired.index - 1 // the loop increment lands on the remainder
        } else {
          index = paired.index
        }
        continue
      }

      const child = items[index]
      if (!child) continue
      if (child.type === 'html' && pendingCloses > 0) {
        // Resolve the retained close with the SAME cross-node lexical state the body built up
        // (a textarea opened in an earlier body node holds its literal `</details>` until the
        // real end tag). The scan seeds depth 1 — a close with no open before it is exactly
        // the retained boundary — and re-arms after every resolution for the next one.
        pendingScanState.count = 1
        const scan = scanContainerBoundaries(child.value, pendingScanState)
        const close =
          scan.closed && scan.closeStart !== undefined && scan.closeEnd !== undefined
            ? { start: scan.closeStart, end: scan.closeEnd }
            : undefined
        if (close !== undefined) {
          // This close belongs to an opening retained in a shared opening node: emit it raw so
          // the retained disclosure actually closes instead of swallowing the following prose.
          if (close.start > 0) {
            // Content preceding the boundary keeps the normal path, like a shared close prefix.
            processRange([sliceHtmlNode(child, 0, close.start)], 0, 1, pendingCloses)
          }
          children.push(sliceHtmlNode(child, close.start, close.end))
          pendingCloses -= 1
          if (close.end < child.value.length) {
            // Adjacent content (`</details>` and a new `<details>` merge into one html block)
            // re-enters pairing as a fresh open. Leading whitespace on the remainder is
            // insignificant inside the html block.
            const rest = child.value.slice(close.end)
            const remainderStart = close.end + (rest.length - rest.trimStart().length)
            items.splice(index, 1, sliceHtmlNode(child, remainderStart, child.value.length))
            index -= 1 // the loop increment lands on the remainder
          }
          continue
        }
      }
      children.push(
        child.type === 'html' && isHtmlArtifact(child) && !isHtmlDocumentBoundary(child)
          ? createHtmlCodeNode(child)
          : child
      )
    }
  }

  processRange(tree.children, 0, tree.children.length, 0)

  tree.children = children
}
