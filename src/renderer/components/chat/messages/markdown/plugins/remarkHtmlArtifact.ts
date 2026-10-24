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
// A disclosure's label. CommonMark splits it from the opening boundary when a blank line
// separates them, and it must stay raw HTML beside the boundary: an artifact iframe leaves the
// native disclosure without a summary element, so the browser shows its default label.
const HTML_SUMMARY_OPEN_REGEX = /^<summary(?=[\s>])/i

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

// First lexically-real `</html …>` in `value`: occurrences inside comments, unfinished tags,
// CDATA and raw-text bodies (script's escaped regions included) are document TEXT, never the
// document boundary. `state` carries the lexical context across the document's html nodes, so
// a script string hiding `</html>` cannot end the document early.
function findDocumentHtmlClose(value: string, state: ContainerScanState): number | undefined {
  let position = 0
  while (position < value.length) {
    if (state.inComment) {
      const end = value.indexOf('-->', position)
      if (end === -1) return undefined
      position = end + 3
      state.inComment = false
      continue
    }
    if (state.rawText !== undefined) {
      if (state.rawText === 'plaintext') return undefined
      let resume: number | undefined
      if (state.rawText === 'script') {
        resume = scanScriptDataEnd(value, position, state)
      } else {
        const closeRegex = RAW_TEXT_CLOSE_REGEXES.get(state.rawText)
        if (closeRegex) {
          closeRegex.lastIndex = position
          const close = closeRegex.exec(value)
          if (close) resume = close.index + close[0].length
        } else {
          state.rawText = undefined
          continue
        }
      }
      if (resume === undefined) return undefined
      position = resume
      state.rawText = undefined
      continue
    }
    if (state.inCDATA) {
      const end = value.indexOf(']]>', position)
      if (end === -1) return undefined
      position = end + 3
      state.inCDATA = false
      continue
    }
    if (state.inTag) {
      const end = findUnfinishedTagEnd(value, 0, state)
      if (end === undefined) return undefined
      position = end + 1
      state.inTag = false
      applyCompletedTag(value, undefined, 0, end + 1, state)
      continue
    }
    const lt = value.indexOf('<', position)
    if (lt === -1) return undefined
    const closeMatch = /^<\/html\s*>/i.exec(value.slice(lt))
    if (closeMatch) return lt + closeMatch[0].length
    if (value.startsWith('<!--', lt)) {
      const end = value.indexOf('-->', lt + 4)
      if (end === -1) {
        state.inComment = true
        return undefined
      }
      position = end + 3
      continue
    }
    if (value.startsWith('<![CDATA[', lt)) {
      const end = value.indexOf(']]>', lt + 9)
      if (end === -1) {
        state.inCDATA = true
        return undefined
      }
      position = end + 3
      continue
    }
    // A close tag of anything else: its interior holds no boundary, skip past the marker. A
    // foreign-content namespace close leaves that context; a `foreignObject` close leaves the
    // HTML integration point.
    if (value.startsWith('</', lt)) {
      if (/^<\/(?:svg|math)[\s>]/i.test(value.slice(lt))) {
        state.foreignDepth = Math.max((state.foreignDepth ?? 1) - 1, 0)
      } else if (/^<\/foreignobject[\s>]/i.test(value.slice(lt))) {
        state.foreignHtmlIntegrationDepth = Math.max((state.foreignHtmlIntegrationDepth ?? 1) - 1, 0)
      }
      position = lt + 2
      continue
    }
    // An open tag consumes its attribute list whole (quoted `>` included) and may open a
    // raw-text body; an unterminated tag dangles into later nodes. Only an actual tag opener
    // (`<` followed by a name, or a `!` declaration / `?` instruction) starts a tag: a literal
    // `<` in document text (`1 < 2`) advances as text, or it swallows the real `</html>` as
    // its terminator and the document never assembles.
    const tagName = /^<([a-z][a-z0-9-]*)/i.exec(value.slice(lt))?.[1]?.toLowerCase()
    if (tagName === undefined && value[lt + 1] !== '!' && value[lt + 1] !== '?') {
      position = lt + 1
      continue
    }
    state.inTag = true
    if (tagName !== undefined && RAW_TEXT_CLOSE_REGEXES.has(tagName)) state.pendingRawText = tagName
    const end = findUnfinishedTagEnd(value, lt + 1, state)
    if (end === undefined) return undefined
    position = end + 1
    state.inTag = false
    applyCompletedTag(value, tagName, lt, end + 1, state)
  }
  return undefined
}

function findHtmlDocumentEnd(
  children: readonly RootContent[],
  startIndex: number,
  end = children.length
): { index: number; htmlCloseEnd: number } | undefined {
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

  const state: ContainerScanState = { count: 0 }
  for (let index = documentStartIndex; index < end; index += 1) {
    const child = children[index]
    if (child?.type !== 'html') continue
    const htmlCloseEnd = findDocumentHtmlClose(child.value, state)
    if (htmlCloseEnd !== undefined) return { index, htmlCloseEnd }
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
// Same-node raw-text bodies the token regex may consume lazily up to their end tag. `script` is
// excluded: its escaped/double-escaped tokenizer states decide where the element really ends
// (see scanScriptDataEnd), and a lazy first-`</script>` match would expose a following literal
// `</details>` as a boundary. `plaintext` is excluded: it has NO end tag at all — a lazy match
// through `</plaintext>` would treat everything after it as scan-able when its body in fact
// runs to end-of-input. Both still enter the raw-text state through their generic open tag.
const SAME_NODE_RAW_TEXT_ELEMENT_NAMES = RAW_TEXT_ELEMENT_NAMES.filter(
  (name) => name !== 'script' && name !== 'plaintext'
)
// Lexical scan for `<details` / `</details` boundaries: comments, raw-text element bodies and
// ordinary tags are consumed whole, so a literal `</details>` inside them — a comment, a quoted
// attribute — can never close a disclosure. Disclosure tags consume their full attribute list
// (`title="</details>"` is legal HTML whose decoy must not reach the depth counter); a generic
// tag does the same so a quoted `>` never ends the tag early.
const CONTAINER_LEXICAL_TOKEN_REGEX = new RegExp(
  `<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<(${SAME_NODE_RAW_TEXT_ELEMENT_NAMES.join('|')})\\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\\s\\S]*?<\\/\\1\\s*>|<\\/?details(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<\\/(?:foreignobject)(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<\\/(?:svg|math)(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<[a-z](?:"[^"]*"|'[^']*'|[^>"'])*>`,
  'gi'
)

// Script data tokenizer regions (HTML spec): `<!--` opens the escaped region and a `<script`
// inside it re-enters double-escaping — there a literal `</script>` only steps back to escaped
// instead of ending the element, so in `<script>const t="<!--<script></script> literal
// </details>";</script>` the string's `</details>` is script source and the element really ends
// at the LAST `</script>`. The flags ride on the shared scan state because a script body split
// across blank-line-separated html nodes resumes inside its tokenizer region.
const SCRIPT_OPEN_TAG_REGEX = /^<script(?=[\t\n\f />])/i
const SCRIPT_END_TAG_OPEN_REGEX = /^<\/script(?=[\t\n\f />])/i
const SCRIPT_END_TAG_REGEX = /^<\/script\s*>/i

/**
 * Finds where a script element's data truly ends: the offset just past the element-ending
 * `</script …>` tag, or `undefined` while the body (or an unterminated end tag) continues in
 * later nodes. Mutates the script flags on `state` so the region survives across nodes.
 */
function scanScriptDataEnd(value: string, from: number, state: ContainerScanState): number | undefined {
  let escaped = state.scriptEscaped ?? false
  let doubleEscaped = state.scriptDoubleEscaped ?? false
  let position = from
  while (position < value.length) {
    const lt = value.indexOf('<', position)
    // `-->` leaves the escaped/double-escaped region for plain script data (before any earlier
    // `<` would).
    if (escaped || doubleEscaped) {
      const dash = value.indexOf('-->', position)
      if (dash !== -1 && (lt === -1 || dash < lt)) {
        escaped = false
        doubleEscaped = false
        position = dash + 3
        continue
      }
    }
    if (lt === -1) break
    if (value.startsWith('<!--', lt)) {
      // In plain script data this enters the escaped region; inside it (escaped or
      // double-escaped) the sequence is ordinary script text with no state change.
      if (!escaped) {
        escaped = true
        doubleEscaped = false
      }
      position = lt + 4
      continue
    }
    if (SCRIPT_END_TAG_OPEN_REGEX.test(value.slice(lt, lt + 10))) {
      const complete = SCRIPT_END_TAG_REGEX.exec(value.slice(lt))
      if (!complete) break // the end tag itself continues in a later node
      if (!doubleEscaped) {
        state.scriptEscaped = undefined
        state.scriptDoubleEscaped = undefined
        return lt + complete[0].length
      }
      // A double-escaped `</script>` only steps back to escaped script data.
      position = lt + complete[0].length
      doubleEscaped = false
      continue
    }
    if (SCRIPT_OPEN_TAG_REGEX.test(value.slice(lt, lt + 8))) {
      // `<script` inside the escaped region re-enters double-escaping; plain script data
      // treats it as ordinary text.
      if (escaped) doubleEscaped = true
      position = lt + 7
      continue
    }
    position = lt + 1
  }
  state.scriptEscaped = escaped
  state.scriptDoubleEscaped = doubleEscaped
  return undefined
}

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
  /** Script data tokenizer region flags, carried while `rawText === 'script'`. */
  scriptEscaped?: boolean
  scriptDoubleEscaped?: boolean
  /** Foreign-content (SVG/MathML) namespace depth: the raw-text algorithm never applies inside. */
  foreignDepth?: number
  /**
   * HTML integration point depth (`<foreignObject>` in foreign content): its children parse as
   * HTML, so the raw-text algorithm applies again inside it.
   */
  foreignHtmlIntegrationDepth?: number
}

// A completed tag whose `>` is preceded by the self-closing marker. In foreign content it
// genuinely ends the element (`<svg><title/>` has no `</title>` coming); a tag continued from
// a previous node passes the tag text present in `value` — the marker is at the tail or absent.
function isSelfClosingTag(value: string, start: number, end: number): boolean {
  return /\/\s*>$/.test(value.slice(start, end))
}

// Foreign content (SVG/MathML) EXCEPT its HTML integration points (`foreignObject`): inside an
// integration point children parse as HTML, so the raw-text algorithm applies there again.
function isForeignContext(state: ContainerScanState): boolean {
  return (state.foreignDepth ?? 0) > 0 && (state.foreignHtmlIntegrationDepth ?? 0) === 0
}

/**
 * Applies a tag that just completed at offset `tagEnd`: a non-self-closing `<svg>` / `<math>`
 * opens a foreign-content namespace, and a raw-text opener recorded in `pendingRawText` enters
 * its raw-text body — never inside foreign content, where the raw-text algorithm does not
 * apply. HTML has no self-closing on non-void elements (the marker is ignored, so `<script/>`
 * still opens a raw-text body); the marker only matters for the namespace openers themselves.
 * `tagName` is undefined for a tag continued from a previous node, whose opener text is not in
 * `value`.
 */
function applyCompletedTag(
  value: string,
  tagName: string | undefined,
  tagStart: number,
  tagEnd: number,
  state: ContainerScanState
): void {
  const name = tagName?.toLowerCase()
  if (name === 'svg' || name === 'math') {
    if (!isSelfClosingTag(value, tagStart, tagEnd)) state.foreignDepth = (state.foreignDepth ?? 0) + 1
    return
  }
  // A `foreignObject` inside foreign content is an HTML integration point: its children parse
  // as HTML (raw text applies again), so track its depth. Inside an existing integration point
  // it is an ordinary unknown HTML element.
  if (name === 'foreignobject') {
    if (isForeignContext(state) && !isSelfClosingTag(value, tagStart, tagEnd)) {
      state.foreignHtmlIntegrationDepth = (state.foreignHtmlIntegrationDepth ?? 0) + 1
    }
    return
  }
  if (state.pendingRawText !== undefined) {
    if (!isForeignContext(state)) {
      state.rawText = state.pendingRawText
    }
    state.pendingRawText = undefined
  }
}

interface ContainerScanResult {
  closed: boolean
  /** Offset of the closing boundary's `<` when `closed`. */
  closeStart?: number
  /** Offset just past the closing boundary's `>` when `closed`. */
  closeEnd?: number
}

// Whether the stream is inside a construct whose contents are literal text (a raw-text body, an
// unterminated comment, a dangling tag or a CDATA section). A node reached in this state is not
// markup, so it can neither open a disclosure nor start a pairing search.
function isInsideLexicalRegion(state: ContainerScanState): boolean {
  return state.rawText !== undefined || state.inComment === true || state.inTag === true || state.inCDATA === true
}

// A resolved disclosure boundary ends every open lexical construct at once: the pairing scan
// can only reach a real `</details>` once the raw-text body, comment, tag and CDATA section are
// all closed. Reset them so the following nodes start from plain markup.
function resetStreamState(state: ContainerScanState): void {
  state.rawText = undefined
  state.inComment = false
  state.inTag = false
  state.pendingQuote = undefined
  state.inCDATA = false
  state.pendingRawText = undefined
  state.scriptEscaped = undefined
  state.scriptDoubleEscaped = undefined
  state.foreignDepth = undefined
  state.foreignHtmlIntegrationDepth = undefined
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
// zero. With `trackDepth` false the disclosure tokens are ignored for depth: the scan only
// advances the lexical state (comments, raw-text bodies, dangling tags, CDATA), which is what
// a pairing search needs to know about the nodes preceding its own start.
function scanContainerBoundaries(value: string, state: ContainerScanState, trackDepth = true): ContainerScanResult {
  let position = 0
  // Both searches scan to end-of-input on miss while position only grows: cache them, or every
  // token iteration pays a full O(n) re-scan (quadratic on token-dense input).
  let commentStart: number | undefined
  let cdataStart: number | undefined
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
      if (state.rawText === 'script') {
        const end = scanScriptDataEnd(value, position, state)
        if (end === undefined) return { closed: false }
        position = end
        state.rawText = undefined
        continue
      }
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
      applyCompletedTag(value, undefined, 0, end + 1, state)
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

    // Every token alternative ends in `>` (tags, comments, CDATA): with no `>` left the exec
    // below could only fail — and retrying its unanchored scan at every unterminated opener is
    // quadratic on streamed attribute soup. Skip straight to the opener/comment handling, which
    // returns within one iteration.
    let match: RegExpExecArray | null = null
    if (value.indexOf('>', position) !== -1) {
      CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = position
      match = CONTAINER_LEXICAL_TOKEN_REGEX.exec(value)
    }
    // A comment opening before the next token cannot terminate in the remaining input (a
    // complete comment would have matched as the token itself): it swallows the rest of the
    // input — across later nodes — so no boundary inside it may be trusted.
    if (commentStart === undefined || (commentStart !== -1 && commentStart < position)) {
      commentStart = value.indexOf('<!--', position)
    }
    if (cdataStart === undefined || (cdataStart !== -1 && cdataStart < position)) {
      cdataStart = value.indexOf('<![CDATA[', position)
    }
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
      applyCompletedTag(value, tagName, tagStart, end + 1, state)
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
      if (token.startsWith('</svg') || token.startsWith('</math')) {
        state.foreignDepth = Math.max((state.foreignDepth ?? 1) - 1, 0)
        continue
      }
      if (token.startsWith('</foreignobject')) {
        state.foreignHtmlIntegrationDepth = Math.max((state.foreignHtmlIntegrationDepth ?? 1) - 1, 0)
        continue
      }
      const name = /^<([a-z][a-z0-9-]*)/.exec(token)?.[1]
      if (name === 'svg' || name === 'math') {
        if (!isSelfClosingTag(token, 0, token.length)) state.foreignDepth = (state.foreignDepth ?? 0) + 1
        continue
      }
      // A `foreignObject` in foreign content is an HTML integration point (children parse as
      // HTML); inside an existing one it is an ordinary unknown HTML element.
      if (name === 'foreignobject') {
        if (isForeignContext(state) && !isSelfClosingTag(token, 0, token.length)) {
          state.foreignHtmlIntegrationDepth = (state.foreignHtmlIntegrationDepth ?? 0) + 1
        }
        continue
      }
      // HTML has no self-closing on non-void elements: `<script/>` still opens a raw-text body.
      if (name !== undefined && RAW_TEXT_CLOSE_REGEXES.has(name) && !isForeignContext(state)) {
        state.rawText = name
      }
      continue
    }
    if (token[1] === '/') {
      if (!trackDepth) continue
      state.count -= 1
      if (state.count === 0) {
        // The token consumed the complete end tag, quotes included.
        return { closed: true, closeStart: match.index, closeEnd: match.index + match[0].length }
      }
    } else {
      // HTML parsers ignore the trailing slash on a NON-void element's start tag, so
      // `<details … />` is an opening like any other. The token carries the complete tag
      // (quotes consumed), so no `>` inside a quoted attribute can end it early.
      if (!trackDepth) continue
      state.count += 1
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
  let rawText: string | undefined
  let foreignDepth = 0
  let foreignHtmlIntegrationDepth = 0
  // Same monotone-position cache as the pairing scan: an end-of-input miss must not re-scan per
  // token iteration.
  let commentStart: number | undefined
  CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while (true) {
    // A raw-text body opened earlier in this node keeps swallowing content until its end tag;
    // `<plaintext>` never ends (body to end-of-input) and a script body ends where its
    // tokenizer states say — nothing inside either can be a trusted boundary.
    if (rawText !== undefined) {
      if (rawText === 'plaintext') return undefined
      let closeEnd: number | undefined
      if (rawText === 'script') {
        closeEnd = scanScriptDataEnd(value, scanned, { count: 0 })
      } else {
        const closeRegex = RAW_TEXT_CLOSE_REGEXES.get(rawText)
        if (closeRegex) {
          closeRegex.lastIndex = scanned
          const close = closeRegex.exec(value)
          if (close) closeEnd = close.index + close[0].length
        }
      }
      if (closeEnd === undefined) return undefined
      scanned = closeEnd
      rawText = undefined
      CONTAINER_LEXICAL_TOKEN_REGEX.lastIndex = scanned
      continue
    }
    // Same `>` pre-check as the pairing scan: every alternative needs one, and letting the
    // unanchored exec retry at every unterminated opener is quadratic on attribute soup.
    if (value.indexOf('>', scanned) === -1) return undefined
    match = CONTAINER_LEXICAL_TOKEN_REGEX.exec(value)
    if (match === null) return undefined
    if (commentStart === undefined || (commentStart !== -1 && commentStart < scanned)) {
      commentStart = value.indexOf('<!--', scanned)
    }
    if (commentStart !== -1 && commentStart < match.index) {
      return undefined // an unfinished comment opens before the boundary and never terminates
    }
    scanned = match.index + match[0].length
    if (match[1] !== undefined) continue // a same-node raw-text body holds no real boundary
    const token = match[0].toLowerCase()
    if (!token.startsWith('<details') && !token.startsWith('</details')) {
      if (token.startsWith('</svg') || token.startsWith('</math')) {
        foreignDepth = Math.max(foreignDepth - 1, 0)
        continue
      }
      if (token.startsWith('</foreignobject')) {
        foreignHtmlIntegrationDepth = Math.max(foreignHtmlIntegrationDepth - 1, 0)
        continue
      }
      const name = /^<([a-z][a-z0-9-]*)/.exec(token)?.[1]
      if (name === 'svg' || name === 'math') {
        if (!isSelfClosingTag(token, 0, token.length)) foreignDepth += 1
        continue
      }
      // A `foreignObject` in foreign content is an HTML integration point (children parse as
      // HTML); inside an existing one it is an ordinary unknown HTML element.
      if (name === 'foreignobject') {
        if (foreignDepth > 0 && foreignHtmlIntegrationDepth === 0 && !isSelfClosingTag(token, 0, token.length)) {
          foreignHtmlIntegrationDepth += 1
        }
        continue
      }
      // HTML has no self-closing on non-void elements: `<script/>` still opens a raw-text body.
      if (
        name !== undefined &&
        RAW_TEXT_CLOSE_REGEXES.has(name) &&
        !(foreignDepth > 0 && foreignHtmlIntegrationDepth === 0)
      ) {
        rawText = name
      }
      continue
    }
    if (token[1] === '/') {
      if (depth === 0) return { start: match.index, end: match.index + match[0].length }
      depth -= 1
    } else {
      // `<details … />` opens too: HTML ignores the trailing slash on non-void start tags.
      depth += 1
    }
  }
}

// End offset (just past the first `</summary>`) of the summary element starting `value`, or
// undefined when the open tag never completes in this node. The open tag consumes its quoted
// attribute list, so a decoy `</summary>` inside it cannot end the label early.
function findSummaryElementEnd(value: string): number | undefined {
  const open = /^<summary(?=[\s>])(?:"[^"]*"|'[^']*'|[^>"'])*>/i.exec(value)
  if (!open) return undefined
  const close = /<\/summary\s*>/i.exec(value.slice(open[0].length))
  return close ? open[0].length + close.index + close[0].length : undefined
}

// Offset of a `<details` opener reached from `from` across whitespace and complete comments, or
// undefined. A comment sitting between the summary label and the opener does not void the
// opener's bookkeeping — it still shares the node and still needs its pairing entry.
function findDetailsOpenerAfterComments(value: string, from: number): number | undefined {
  let position = from
  while (position < value.length) {
    while (position < value.length && /\s/.test(value[position])) position += 1
    if (value.startsWith('<!--', position)) {
      const end = value.indexOf('-->', position + 4)
      if (end === -1) return undefined // unterminated comment: keep the whole node raw
      position = end + 3
      continue
    }
    return /^<details(?=[\s>])/i.test(value.slice(position)) ? position : undefined
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
  /** Lexical state at the opening node's end — the paired body continues this stream. */
  bodyEntryState: ContainerScanState
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
  // The body's first node continues the stream EXACTLY as the opening node left it — a
  // raw-text body (or dangling comment/tag/CDATA) opened beside the retained openings holds
  // the body's own literals, so the body scan must resume inside it, not start fresh.
  const bodyEntryState: ContainerScanState = { ...state }
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
        retainedOpens,
        bodyEntryState
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
    const documentEnd = findHtmlDocumentEnd(tree.children, index)
    if (documentEnd !== undefined) {
      const range = getSourceRange(tree.children.slice(index, documentEnd.index + 1))
      if (range) ranges.push(range)
      index = documentEnd.index
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
  // the range must keep their closes raw instead of letting them become code. `entryState`
  // carries the enclosing opening node's lexical state (raw-text body, dangling comment or
  // tag, script tokenizer region) into the retained-close scan: the body's first html node
  // continues that stream, so its literals must not resolve as boundaries.
  const processRange = (
    items: RootContent[],
    from: number,
    to: number,
    retainedOpens: number,
    entryState?: ContainerScanState
  ): void => {
    let pendingCloses = retainedOpens
    // Lexical state for resolving retained closes across the body's html nodes: depth 1 means
    // "the next unmatched close is the retained one" — it re-arms only AFTER a resolution, so
    // the depth the body's own nested openings accumulate survives between resolutions.
    const pendingScanState: ContainerScanState = entryState ? { ...entryState, count: 1 } : { count: 1 }
    // Lexical state of the stream at the CURRENT node's start, carried across the range's html
    // nodes. A node reached inside a raw-text body, comment, dangling tag or CDATA section is
    // literal text: its `<details>`/`<html>` are never markup, so it must not start a pairing
    // search or a document artifact — a fresh scan would treat a textarea literal as a real
    // opener and consume the next disclosure's close. Only the lexical fields matter here;
    // disclosure depth is tracked by the pairing/pending scans themselves.
    const streamState: ContainerScanState = entryState ? { ...entryState, count: 0 } : { count: 0 }
    for (let index = from; index < to; index += 1) {
      const insideLiteralRegion = isInsideLexicalRegion(streamState)
      const documentEnd = insideLiteralRegion ? undefined : findHtmlDocumentEnd(items, index, to)
      if (documentEnd !== undefined) {
        const documentEndIndex = documentEnd.index
        let documentNodes = items.slice(index, documentEndIndex + 1)
        let resumeIndex = documentEndIndex
        // A document tail sharing its node with the closes owed to retained openings (a shared
        // opening node's `</details>` merged after `</html>`) must not be swallowed into the
        // artifact: split the tail off so the pending-close path below can keep those closes
        // raw. The boundary offset comes from the LEXICAL document-end search — a literal
        // `</html>` inside a script string is document text, never the boundary.
        if (pendingCloses > 0) {
          const last = items[documentEndIndex]
          if (last?.type === 'html') {
            const htmlEnd = documentEnd.htmlCloseEnd
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
        // The consumed range continues the stream: its last html node may leave a raw-text
        // body or dangling tag open for the following nodes.
        for (const node of documentNodes) {
          if (node.type === 'html') scanContainerBoundaries(node.value, streamState, false)
        }
        index = resumeIndex
        continue
      }

      const paired = insideLiteralRegion ? undefined : findPairedContainerClose(items, index, to)
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
        // CommonMark splits a blank-line-separated `<summary>` from the opening boundary: it is
        // the disclosure's LABEL, so it stays raw beside the boundary — as an artifact iframe
        // the native disclosure has no summary element and the browser shows its default label.
        let bodyStart = 0
        // Disclosures opened in the label node's remainder (see below) owe this body range
        // their closes.
        let remainderOpens = 0
        const firstBody = body[0]
        if (firstBody?.type === 'html' && HTML_SUMMARY_OPEN_REGEX.test(stripLeadingHtmlMetadata(firstBody.value))) {
          const summaryEnd = findSummaryElementEnd(firstBody.value)
          if (summaryEnd !== undefined) {
            const rest = firstBody.value.slice(summaryEnd)
            // Leading whitespace on the remainder is insignificant inside the html block.
            const restStart = summaryEnd + (rest.length - rest.trimStart().length)
            const openerStart = findDetailsOpenerAfterComments(firstBody.value, restStart)
            if (openerStart !== undefined) {
              // The label shares its node with an inner disclosure opener (possibly behind
              // comments): only the label stays raw, the opener re-enters pairing — skipping
              // the whole node orphaned the inner close onto the artifact path. Whitespace and
              // the comments between are insignificant inside the html block and are dropped.
              children.push(sliceHtmlNode(firstBody, 0, summaryEnd))
              body[0] = sliceHtmlNode(firstBody, openerStart, firstBody.value.length)
            } else {
              children.push(firstBody)
              bodyStart = 1
              // Body content before any opener (`<div>…`) voids the opener search above, but
              // the remainder can still OPEN disclosures: count them (scratch state only) so
              // the body range keeps their closes raw.
              const remainderState: ContainerScanState = { count: 0 }
              scanContainerBoundaries(rest, remainderState)
              remainderOpens = remainderState.count
            }
          } else {
            // The label's open tag never completed in this node (streaming): keep the whole
            // node raw, as before the split existed.
            children.push(firstBody)
            bodyStart = 1
          }
        }
        // The paired close closes the outermost opening of the opening node; every opening
        // retained next to it has no matching open inside the body, so its close arrives as an
        // unpaired body node and must stay raw (see the fallback below).
        processRange(
          body,
          bodyStart,
          body.length,
          Math.max(paired.retainedOpens - 1, 0) + remainderOpens,
          paired.bodyEntryState
        )
        children.push(sliceHtmlNode(closeNode, paired.closeStart, paired.closeEnd))
        // At the close the lexical stream is plain: the pairing scan could only resolve a real
        // `</details>` boundary once every raw-text body, comment, tag and CDATA section ended.
        resetStreamState(streamState)
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
        // real end tag). The scan keeps the depth accumulated across earlier body nodes — a
        // nested opening raises it, so only the close that brings it back to 1→0 is the
        // retained boundary; the seed re-arms after each resolution for the next one.
        const stateBeforeNode: ContainerScanState = { ...pendingScanState }
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
            // It continues the lexical stream as of BEFORE this node — a raw-text body opened
            // in an earlier body node holds the prefix's own literals, so a fresh scan would
            // fire on them and emit a stray raw close.
            processRange([sliceHtmlNode(child, 0, close.start)], 0, 1, pendingCloses, stateBeforeNode)
          }
          children.push(sliceHtmlNode(child, close.start, close.end))
          pendingCloses -= 1
          pendingScanState.count = 1
          // The resolved close is a real boundary: the lexical stream is plain after it.
          resetStreamState(streamState)
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
      // The node continues the lexical stream for the NEXT nodes: a raw-text body, comment,
      // dangling tag or CDATA section opened here holds their literals as text.
      if (child.type === 'html') scanContainerBoundaries(child.value, streamState, false)
    }
  }

  processRange(tree.children, 0, tree.children.length, 0)

  tree.children = children
}
