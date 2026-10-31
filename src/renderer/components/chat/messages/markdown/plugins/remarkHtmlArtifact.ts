import type { Code, Html, Root, RootContent } from 'mdast'
import remarkParse from 'remark-parse'
import type { Plugin } from 'unified'
import { unified } from 'unified'

const LEADING_HTML_METADATA_REGEX = /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>))*/i
const HTML_DOCUMENT_START_REGEX = /^<html(?:\s|>)/i
// The tail of an END tag: the HTML tokenizer consumes (and ignores) attributes on end tags,
// so `</script data-x="a>b">` really closes the element — a `\s*>` pattern rejects it and
// leaves the lexical region open, hanging the stream. Quoted attribute values may hide `>`.
const END_TAG_TAIL_PATTERN = String.raw`(?=[\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>`
const HTML_DOCUMENT_END_REGEX = new RegExp(`</html${END_TAG_TAIL_PATTERN}`, 'i')
const HTML_CLOSE_TAG_REGEX = new RegExp(`^</html${END_TAG_TAIL_PATTERN}`, 'i')
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
    const closeMatch = HTML_CLOSE_TAG_REGEX.exec(value.slice(lt))
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
    // foreign-content namespace close leaves that context; an integration-point close
    // (`foreignObject`/`desc`/`title`, the MathML text integration points, or an HTML-encoded
    // `annotation-xml`) leaves the HTML integration point.
    if (value.startsWith('</', lt)) {
      if (/^<\/(?:svg|math)[\s>/]/i.test(value.slice(lt))) {
        popForeignContext(state, 'F')
      } else if (FOREIGN_INTEGRATION_CLOSE_REGEX.test(value.slice(lt))) {
        popForeignContext(state, 'I')
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

// HTML raw-text elements: everything up to the matching end tag is literal text (script/style/
// noscript are raw text, textarea/title RCDATA, iframe/xmp/noembed/noframes use the raw-text
// algorithm), so a literal `</details>` inside them — script source, textarea fallback, noembed
// fallback — can never close a disclosure. `noscript` holds raw text under scripting-enabled
// parsing — the document context the pairing decision mirrors. `plaintext` is special: it has
// NO end tag at all, its body runs to end-of-input, so nothing after it is ever a boundary.
const RAW_TEXT_ELEMENT_NAMES = [
  'script',
  'style',
  'textarea',
  'title',
  'iframe',
  'xmp',
  'noembed',
  'noframes',
  'noscript',
  'plaintext'
]
// A raw-text body opened in one html node can continue into the following nodes (a blank line
// splits html blocks), so the end tag is located with the same per-element pattern the
// same-node token match uses. The `g` flag is load-bearing: the cross-node scan positions the
// search with `lastIndex`, and without `g` a regex ignores it — finding an EARLIER element's
// close, moving the cursor backward, and looping forever on consecutive raw-text elements
// whose second close has not arrived yet.
const RAW_TEXT_CLOSE_REGEXES = new Map(
  RAW_TEXT_ELEMENT_NAMES.map((name) => [name, new RegExp(`</${name}${END_TAG_TAIL_PATTERN}`, 'gi')])
)
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
const CONTAINER_LEXICAL_TOKEN_PATTERN = `<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<(${SAME_NODE_RAW_TEXT_ELEMENT_NAMES.join('|')})\\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\\s\\S]*?<\\/\\1${END_TAG_TAIL_PATTERN}|<\\/?details(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<\\/(?:foreignobject|desc|title|annotation-xml|mtext|mi|mo|mn|ms)(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<\\/(?:svg|math)(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>|<[a-z](?:"[^"]*"|'[^']*'|[^>"'])*>`
// Anchored: every token alternative starts at a fixed marker, so the candidate positions are
// found with linear monotone searches and the token is matched AT its own position. A failed
// anchored attempt never re-scans the input — the unanchored regex retries its attribute-soup
// backtracking at every later opener, which is quadratic on inputs like `<div>\n<a <a … " >`
// (no complete token, every position carries an unfinished-tag attempt).
const CONTAINER_LEXICAL_TOKEN_STICKY_REGEX = new RegExp(CONTAINER_LEXICAL_TOKEN_PATTERN, 'yi')
// First `</` opening one of the dedicated close-token alternatives — the third candidate class
// (comments, CDATA and tag openers have their own linear searches).
const CONTAINER_CLOSE_TOKEN_START_REGEX =
  /<\/(?:details|foreignobject|desc|title|annotation-xml|mtext|mi|mo|mn|ms|svg|math)(?=[\s>/])/gi
// Dedicated close tokens that LEAVE an HTML integration point: the SVG ones
// (`foreignObject`/`desc`/`title` in foreign content), the MathML text integration points
// (`mi`/`mo`/`mn`/`ms`/`mtext`) and an HTML-encoded `annotation-xml`.
const FOREIGN_INTEGRATION_CLOSE_REGEX = /^<\/(?:foreignobject|desc|title|annotation-xml|mtext|mi|mo|mn|ms)(?=[\s>/])/i
// Anchored open-tag match for a foreign-content `title`: its children parse as HTML (an HTML
// integration point), so the scanner must consume ONLY the open tag there — never the lazy
// same-node body up to the first literal `</title>` (a `<script>` child hides that literal).
const TITLE_OPEN_TAG_REGEX = new RegExp(`^<title(?=[\\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'i')

// Script data tokenizer regions (HTML spec): `<!--` opens the escaped region and a `<script`
// inside it re-enters double-escaping — there a literal `</script>` only steps back to escaped
// instead of ending the element, so in `<script>const t="<!--<script></script> literal
// </details>";</script>` the string's `</details>` is script source and the element really ends
// at the LAST `</script>`. The flags ride on the shared scan state because a script body split
// across blank-line-separated html nodes resumes inside its tokenizer region.
const SCRIPT_OPEN_TAG_REGEX = /^<script(?=[\t\n\f />])/i
const SCRIPT_END_TAG_OPEN_REGEX = /^<\/script(?=[\t\n\f />])/i
// The end tag may carry (ignored) attributes: `</script data-x>` closes the element like a
// bare `</script>` does. A `\s*>` pattern rejects it and leaves the body hanging open.
const SCRIPT_END_TAG_REGEX = new RegExp(`^</script${END_TAG_TAIL_PATTERN}`, 'i')

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
  /**
   * Foreign-content namespace STACK: one character per open special element — `F` for an
   * svg/math namespace, `I` for an HTML integration point (`foreignObject`, in foreign
   * content `desc`/`title`, the MathML text integration points, an HTML-encoded
   * `annotation-xml`). The stack (not independent counters) is load-bearing: a nested
   * `<svg>` inside an integration point re-enters FOREIGN content, and leaving it must
   * restore the enclosing integration point. The raw-text algorithm applies exactly when the
   * INNERMOST open context is `F`.
   */
  foreignContext?: string
}

// A completed tag whose `>` is preceded by the self-closing marker. In foreign content it
// genuinely ends the element (`<svg><title/>` has no `</title>` coming); a tag continued from
// a previous node passes the tag text present in `value` — the marker is at the tail or absent.
function isSelfClosingTag(value: string, start: number, end: number): boolean {
  return /\/\s*>$/.test(value.slice(start, end))
}

// Pushes one namespace context onto the foreign-content stack (`F` = svg/math, `I` = an HTML
// integration point).
function pushForeignContext(state: ContainerScanState, context: 'F' | 'I'): void {
  state.foreignContext = (state.foreignContext ?? '') + context
}

// Pops the innermost open context of `context`, together with everything opened inside it (a
// close of an outer element while inner ones are still open is malformed nesting whose
// interior ends with the element). A stray close of an element that is not open at all leaves
// the stack empty — the same no-op the counter clamps this replaces had.
function popForeignContextStack(stack: string, context: 'F' | 'I'): string {
  const index = stack.lastIndexOf(context)
  return index === -1 ? '' : stack.slice(0, index)
}

function popForeignContext(state: ContainerScanState, context: 'F' | 'I'): void {
  state.foreignContext = popForeignContextStack(state.foreignContext ?? '', context)
}

// Foreign content (SVG/MathML) EXCEPT its HTML integration points (`foreignObject`, in foreign
// content `desc`/`title`, the MathML text integration points, an HTML-encoded `annotation-xml`):
// inside an integration point children parse as HTML, so the raw-text algorithm applies there
// again. Decided by the INNERMOST open context: a nested `<svg>` inside an integration point is
// foreign again even though the integration point is still open around it.
function isForeignContext(state: ContainerScanState): boolean {
  return (state.foreignContext ?? '').endsWith('F')
}

// An `annotation-xml` element is an HTML integration point only when its `encoding` attribute
// is an ASCII case-insensitive match for an HTML document media type.
function isHtmlIntegrationEncoding(tag: string): boolean {
  const encoding = /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(tag)
  const value = (encoding?.[1] ?? encoding?.[2] ?? encoding?.[3] ?? '').trim().toLowerCase()
  return value === 'text/html' || value === 'application/xhtml+xml'
}

/**
 * Applies a tag that just completed at offset `tagEnd`: a non-self-closing `<svg>` / `<math>`
 * opens a foreign-content namespace, and a raw-text opener recorded in `pendingRawText` enters
 * its raw-text body — never inside foreign content, where the raw-text algorithm does not
 * apply. An integration-point opener (`foreignObject`, and in foreign content `desc`/`title`)
 * records that its children parse as HTML again. HTML has no self-closing on non-void elements
 * (the marker is ignored, so `<script/>` still opens a raw-text body); the marker only matters
 * for the namespace openers themselves. `tagName` is undefined for a tag continued from a
 * previous node, whose opener text is not in `value`.
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
    // A foreign namespace opens INSIDE whatever context it appears in — an `<svg>` within an
    // HTML integration point re-enters foreign content (nested-SVG documents).
    if (!isSelfClosingTag(value, tagStart, tagEnd)) pushForeignContext(state, 'F')
    return
  }
  // svg `foreignObject`/`desc`/`title` are HTML integration points: their children parse as
  // HTML (raw text applies again), so track their depth. Inside an existing integration point
  // they are ordinary unknown HTML elements.
  if (name === 'foreignobject' || name === 'desc' || name === 'title') {
    if (isForeignContext(state) && !isSelfClosingTag(value, tagStart, tagEnd)) {
      pushForeignContext(state, 'I')
      // The integration point's children parse as HTML: a pending raw-text transition (a
      // `title` opener recorded before its tag completed) is voided, and the pending opener
      // must not linger for the NEXT completed tag.
      state.pendingRawText = undefined
      return
    }
    // A `title` outside foreign content is an ordinary HTML raw-text element and still enters
    // its body through the pendingRawText handling below; `desc`/`foreignObject` are then
    // ordinary unknown HTML elements.
    if (name !== 'title') return
  }
  // The MathML text integration points parse their children as HTML in foreign content (a
  // `<script>` inside them is an HTML raw-text element); an `annotation-xml` is an integration
  // point only with an HTML document encoding. Outside foreign content they are ordinary
  // non-raw-text elements. (Per spec the text integration points are MathML-only — inside SVG
  // `mtext` etc. are ordinary foreign elements — but foreign content can never host a real
  // `</details>` boundary either way, so treating them as integration points keeps the literal
  // suppression that boundary detection needs.)
  if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext') {
    if (isForeignContext(state) && !isSelfClosingTag(value, tagStart, tagEnd)) {
      pushForeignContext(state, 'I')
      state.pendingRawText = undefined
    }
    return
  }
  if (name === 'annotation-xml') {
    if (
      isForeignContext(state) &&
      isHtmlIntegrationEncoding(value.slice(tagStart, tagEnd)) &&
      !isSelfClosingTag(value, tagStart, tagEnd)
    ) {
      pushForeignContext(state, 'I')
      state.pendingRawText = undefined
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
  state.foreignContext = undefined
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
// a pairing search needs to know about the nodes preceding its own start. `countMinOut`, when
// provided, receives the LOWEST depth value observed during this node's scan — the suffix
// memo needs the within-node dip, not just the node's net delta, to know which entry counts
// could resolve inside the node.
// A details-boundary observer for the pairing scan: `isOpen` distinguishes the two boundary
// kinds, start/end locate the token inside the scanned value. Fired ONLY for the depth-moving
// `<details`/`</details` tokens (never for comments, raw text or other tags) and never across
// nodes — the observer is a per-scan-call parameter, not carried on the shared state, so no
// snapshot can capture a stale one.
type ContainerTokenSink = (isOpen: boolean, start: number, end: number) => void

function scanContainerBoundaries(
  value: string,
  state: ContainerScanState,
  trackDepth = true,
  countMinOut?: { value: number },
  tokenSink?: ContainerTokenSink
): ContainerScanResult {
  let position = 0
  // Both searches scan to end-of-input on miss while position only grows: cache them, or every
  // token iteration pays a full O(n) re-scan (quadratic on token-dense input).
  let commentStart: number | undefined
  let cdataStart: number | undefined
  // The close-token candidate search and its cursor: same monotone cache, plus a cursor that
  // survives a skipped candidate (a `</name…` prefix that never completes in this node).
  let closeStart: number | undefined
  let closeCursor = 0
  // The tag-opener candidate search joins the same monotone cache: an end-of-input miss must
  // not re-scan the remaining input per token iteration (quadratic on a close-dense tail with
  // no opener ahead, e.g. repeated `</svg>` closes).
  let openerStart: number | undefined
  let openerCursor = 0
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

    // Token candidates: every alternative starts at a fixed marker (`<!--`, `<![CDATA[`, a
    // `</`-close of the dedicated names, or a tag opener `<`+letter), and each marker is found
    // with a linear monotone search. The EARLIEST candidate wins and its token is matched
    // ANCHORED at its own position — an unanchored exec here instead retries the attribute-soup
    // backtracking at every later opener, which is quadratic on `<div>\n<a <a … " >`.
    if (commentStart === undefined || (commentStart !== -1 && commentStart < position)) {
      commentStart = value.indexOf('<!--', position)
    }
    if (cdataStart === undefined || (cdataStart !== -1 && cdataStart < position)) {
      cdataStart = value.indexOf('<![CDATA[', position)
    }
    if (closeCursor < position) closeCursor = position
    if (closeStart === undefined || (closeStart !== -1 && closeStart < closeCursor)) {
      CONTAINER_CLOSE_TOKEN_START_REGEX.lastIndex = closeCursor
      const closeCandidate = CONTAINER_CLOSE_TOKEN_START_REGEX.exec(value)
      closeStart = closeCandidate !== null ? closeCandidate.index : -1
      closeCursor = closeCandidate !== null ? closeCandidate.index : value.length
    }
    // A tag opener that precedes every complete token never completes in this node — its
    // attribute text may hide boundaries. The search is cached like the other candidates: a
    // miss is remembered until end-of-input (a later position can never resurrect it), and a
    // hit is remembered until the cursor advances past it.
    if (openerCursor < position) openerCursor = position
    if (openerStart === undefined || (openerStart !== -1 && openerStart < position)) {
      TAG_OPENER_REGEX.lastIndex = openerCursor
      const opener = TAG_OPENER_REGEX.exec(value)
      openerStart = opener !== null ? opener.index : -1
      openerCursor = opener !== null ? opener.index : value.length
    }
    const tagStart = openerStart !== -1 ? openerStart : undefined
    // A comment opening before the next token cannot terminate in the remaining input (a
    // complete comment would have matched as the token itself): it swallows the rest of the
    // input — across later nodes — so no boundary inside it may be trusted.
    const commentFirst =
      commentStart !== -1 &&
      (cdataStart === -1 || commentStart < cdataStart) &&
      (closeStart === -1 || commentStart < closeStart) &&
      (tagStart === undefined || commentStart < tagStart)
    if (commentFirst) {
      const end = value.indexOf('-->', commentStart + 4)
      if (end === -1) {
        state.inComment = true
        return { closed: false }
      }
      position = end + 3
      continue
    }
    const cdataFirst =
      cdataStart !== -1 &&
      (closeStart === -1 || cdataStart < closeStart) &&
      (tagStart === undefined || cdataStart < tagStart)
    if (cdataFirst) {
      const end = value.indexOf(']]>', cdataStart + 9)
      if (end === -1) {
        state.inCDATA = true
        return { closed: false }
      }
      position = end + 3
      continue
    }
    let match: RegExpExecArray | null = null
    if (closeStart !== -1 && (tagStart === undefined || closeStart < tagStart)) {
      // The dedicated close alternatives are the only ones that can match at a `</name` start.
      CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.lastIndex = closeStart
      match = CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.exec(value)
      if (match === null) {
        // The close never completes here (lookahead or `>` missing): skip its name and keep
        // looking — the unanchored scan skipped it the same way.
        closeCursor = closeStart + 2
        closeStart = undefined
        continue
      }
    } else if (tagStart !== undefined) {
      CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.lastIndex = tagStart
      match = CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.exec(value)
      if (match === null) {
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
      // A same-node raw-text match on `title` inside foreign content is bogus: there `title`
      // is an HTML integration point (its children parse as HTML), so a `<script>` child is
      // raw text and hides the first literal `</title>` — the lazy match stops at that literal
      // and exposes the `</details>` behind it. Consume only the open tag and mark the
      // integration point instead.
      if (match[1] !== undefined && match[1].toLowerCase() === 'title' && isForeignContext(state)) {
        const openTag = TITLE_OPEN_TAG_REGEX.exec(value.slice(tagStart))
        if (openTag !== null) {
          if (!isSelfClosingTag(value, tagStart, tagStart + openTag[0].length)) {
            pushForeignContext(state, 'I')
          }
          state.pendingRawText = undefined
          position = tagStart + openTag[0].length
          continue
        }
      }
    } else {
      return { closed: false }
    }
    position = match.index + match[0].length

    // A same-node raw-text element consumed its whole body including the end tag.
    if (match[1] !== undefined) continue

    const token = match[0].toLowerCase()
    // Comments, raw-text bodies and ordinary tags are consumed without touching the depth —
    // only the details boundaries themselves open and close the disclosure. A generic match on
    // a raw-text open means its end tag is not in this node: the body continues in later nodes.
    if (!token.startsWith('<details') && !token.startsWith('</details')) {
      if (token.startsWith('</svg') || token.startsWith('</math')) {
        popForeignContext(state, 'F')
        continue
      }
      // An integration-point close (`foreignObject`/`desc`/`title`, the MathML text
      // integration points, or an HTML-encoded `annotation-xml`) leaves the HTML integration
      // point.
      if (FOREIGN_INTEGRATION_CLOSE_REGEX.test(token)) {
        popForeignContext(state, 'I')
        continue
      }
      const name = /^<([a-z][a-z0-9-]*)/.exec(token)?.[1]
      if (name === 'svg' || name === 'math') {
        if (!isSelfClosingTag(token, 0, token.length)) pushForeignContext(state, 'F')
        continue
      }
      // svg `foreignObject`/`desc`/`title` are HTML integration points (children parse as
      // HTML); inside an existing one they are ordinary unknown HTML elements. Their children
      // parse as HTML, so no raw-text body opens inside them — a `title` outside foreign
      // content is an ordinary HTML raw-text element and enters its body below.
      if (name === 'foreignobject') {
        if (isForeignContext(state) && !isSelfClosingTag(token, 0, token.length)) {
          pushForeignContext(state, 'I')
        }
        continue
      }
      if (name === 'desc' || name === 'title') {
        if (isForeignContext(state)) {
          if (!isSelfClosingTag(token, 0, token.length)) {
            pushForeignContext(state, 'I')
          }
          continue
        }
      }
      // The MathML text integration points (`mi`/`mo`/`mn`/`ms`/`mtext`) and an HTML-encoded
      // `annotation-xml`: same integration-point handling as above (children parse as HTML, so
      // a `<script>` inside them is raw text). Outside foreign content they are ordinary
      // non-raw-text elements. (Per spec the text integration points are MathML-only — inside
      // SVG they are ordinary foreign elements — but foreign content can never host a real
      // `</details>` boundary either way, so this keeps the literal suppression that boundary
      // detection needs.)
      if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext') {
        if (isForeignContext(state) && !isSelfClosingTag(token, 0, token.length)) {
          pushForeignContext(state, 'I')
        }
        continue
      }
      if (name === 'annotation-xml') {
        if (isForeignContext(state) && isHtmlIntegrationEncoding(token) && !isSelfClosingTag(token, 0, token.length)) {
          pushForeignContext(state, 'I')
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
      if (countMinOut !== undefined && state.count < countMinOut.value) countMinOut.value = state.count
      tokenSink?.(false, match.index, match.index + match[0].length)
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
      tokenSink?.(true, match.index, match.index + match[0].length)
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
  // Local foreign-content namespace stack (same encoding as ContainerScanState.foreignContext):
  // a scratch context for this node-only scan.
  let foreignContext = ''
  const localIsForeign = (): boolean => foreignContext.endsWith('F')
  // Same monotone-position caches as the pairing scan: an end-of-input miss must not re-scan
  // per token iteration.
  let commentStart: number | undefined
  let closeStart: number | undefined
  let closeCursor = 0
  // Same monotone opener cache as the pairing scan: an end-of-input miss must not re-scan per
  // token iteration.
  let openerStart: number | undefined
  let openerCursor = 0
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
      continue
    }
    // Earliest candidate wins and its token is matched ANCHORED at its own position (same
    // reasoning as the pairing scan: the unanchored exec retries its attribute-soup
    // backtracking at every later opener, which is quadratic on `<div>\n<a <a … " >`).
    if (commentStart === undefined || (commentStart !== -1 && commentStart < scanned)) {
      commentStart = value.indexOf('<!--', scanned)
    }
    if (closeCursor < scanned) closeCursor = scanned
    if (closeStart === undefined || (closeStart !== -1 && closeStart < closeCursor)) {
      CONTAINER_CLOSE_TOKEN_START_REGEX.lastIndex = closeCursor
      const closeCandidate = CONTAINER_CLOSE_TOKEN_START_REGEX.exec(value)
      closeStart = closeCandidate !== null ? closeCandidate.index : -1
      closeCursor = closeCandidate !== null ? closeCandidate.index : value.length
    }
    if (openerCursor < scanned) openerCursor = scanned
    if (openerStart === undefined || (openerStart !== -1 && openerStart < scanned)) {
      TAG_OPENER_REGEX.lastIndex = openerCursor
      const opener = TAG_OPENER_REGEX.exec(value)
      openerStart = opener !== null ? opener.index : -1
      openerCursor = opener !== null ? opener.index : value.length
    }
    const tagStart = openerStart !== -1 ? openerStart : undefined
    // An unfinished comment opening before the boundary never terminates: it swallows the rest
    // of the node, so no boundary inside or after it (within this node) may be trusted.
    if (
      commentStart !== -1 &&
      (closeStart === -1 || commentStart < closeStart) &&
      (tagStart === undefined || commentStart < tagStart)
    ) {
      const end = value.indexOf('-->', commentStart + 4)
      if (end === -1) return undefined
      scanned = end + 3
      continue
    }
    let match: RegExpExecArray | null = null
    if (closeStart !== -1 && (tagStart === undefined || closeStart < tagStart)) {
      CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.lastIndex = closeStart
      match = CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.exec(value)
      if (match === null) {
        closeCursor = closeStart + 2
        closeStart = undefined
        continue
      }
    } else if (tagStart !== undefined) {
      CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.lastIndex = tagStart
      match = CONTAINER_LEXICAL_TOKEN_STICKY_REGEX.exec(value)
      if (match === null) {
        // An opener that never completes in this node is transparent here (its interior is not
        // consumed): skip it and keep looking, like the unanchored scan did.
        openerCursor = tagStart + 1
        openerStart = undefined
        continue
      }
      // A same-node raw-text match on `title` inside foreign content is bogus: there `title`
      // is an HTML integration point (its children parse as HTML), so a `<script>` child is
      // raw text and hides the first literal `</title>` — the lazy match stops at that literal
      // and exposes the `</details>` behind it. Consume only the open tag and mark the
      // integration point instead.
      if (match[1] !== undefined && match[1].toLowerCase() === 'title' && localIsForeign()) {
        const openTag = TITLE_OPEN_TAG_REGEX.exec(value.slice(tagStart))
        if (openTag !== null) {
          if (!isSelfClosingTag(value, tagStart, tagStart + openTag[0].length)) foreignContext += 'I'
          scanned = tagStart + openTag[0].length
          continue
        }
      }
    } else {
      return undefined
    }
    scanned = match.index + match[0].length
    if (match[1] !== undefined) continue // a same-node raw-text body holds no real boundary
    const token = match[0].toLowerCase()
    if (!token.startsWith('<details') && !token.startsWith('</details')) {
      if (token.startsWith('</svg') || token.startsWith('</math')) {
        foreignContext = popForeignContextStack(foreignContext, 'F')
        continue
      }
      // An integration-point close (`foreignObject`/`desc`/`title`, the MathML text
      // integration points, or an HTML-encoded `annotation-xml`) leaves the HTML integration
      // point.
      if (FOREIGN_INTEGRATION_CLOSE_REGEX.test(token)) {
        foreignContext = popForeignContextStack(foreignContext, 'I')
        continue
      }
      const name = /^<([a-z][a-z0-9-]*)/.exec(token)?.[1]
      if (name === 'svg' || name === 'math') {
        if (!isSelfClosingTag(token, 0, token.length)) foreignContext += 'F'
        continue
      }
      // svg `foreignObject`/`desc`/`title` are HTML integration points (children parse as
      // HTML); inside an existing one they are ordinary unknown HTML elements. Their children
      // parse as HTML, so no raw-text body opens inside them — a `title` outside foreign
      // content is an ordinary HTML raw-text element and enters its body below.
      if (name === 'foreignobject') {
        if (localIsForeign() && !isSelfClosingTag(token, 0, token.length)) {
          foreignContext += 'I'
        }
        continue
      }
      if (name === 'desc' || name === 'title') {
        if (localIsForeign()) {
          if (!isSelfClosingTag(token, 0, token.length)) {
            foreignContext += 'I'
          }
          continue
        }
      }
      // The MathML text integration points (`mi`/`mo`/`mn`/`ms`/`mtext`) and an HTML-encoded
      // `annotation-xml`: same integration-point handling as above (children parse as HTML, so
      // a `<script>` inside them is raw text). Outside foreign content they are ordinary
      // non-raw-text elements. (Per spec the text integration points are MathML-only — inside
      // SVG they are ordinary foreign elements — but foreign content can never host a real
      // `</details>` boundary either way, so this keeps the literal suppression that boundary
      // detection needs.)
      if (name === 'mi' || name === 'mo' || name === 'mn' || name === 'ms' || name === 'mtext') {
        if (localIsForeign() && !isSelfClosingTag(token, 0, token.length)) {
          foreignContext += 'I'
        }
        continue
      }
      if (name === 'annotation-xml') {
        if (localIsForeign() && isHtmlIntegrationEncoding(token) && !isSelfClosingTag(token, 0, token.length)) {
          foreignContext += 'I'
        }
        continue
      }
      // HTML has no self-closing on non-void elements: `<script/>` still opens a raw-text body.
      if (name !== undefined && RAW_TEXT_CLOSE_REGEXES.has(name) && !localIsForeign()) {
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
// attribute list, so a decoy `</summary>` inside it cannot end the label early; the close may
// carry (ignored) attributes like any browser-recognized end tag.
const SUMMARY_CLOSE_TAG_REGEX = new RegExp(`</summary${END_TAG_TAIL_PATTERN}`, 'i')
function findSummaryElementEnd(value: string): number | undefined {
  const open = /^<summary(?=[\s>])(?:"[^"]*"|'[^']*'|[^>"'])*>/i.exec(value)
  if (!open) return undefined
  const close = SUMMARY_CLOSE_TAG_REGEX.exec(value.slice(open[0].length))
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

// Copies the lexical scan fields (everything except the disclosure depth): `{...spread}` is
// not enough here because a field merely ASSIGNED undefined in one state must clear the same
// field when it still holds a value in the target.
function copyScanLexicalState(target: ContainerScanState, source: ContainerScanState): void {
  target.rawText = source.rawText
  target.inComment = source.inComment
  target.inTag = source.inTag
  target.pendingQuote = source.pendingQuote
  target.inCDATA = source.inCDATA
  target.pendingRawText = source.pendingRawText
  target.scriptEscaped = source.scriptEscaped
  target.scriptDoubleEscaped = source.scriptDoubleEscaped
  target.foreignContext = source.foreignContext
}

function sameScanLexicalState(a: ContainerScanState, b: ContainerScanState): boolean {
  return (
    a.rawText === b.rawText &&
    a.inComment === b.inComment &&
    a.inTag === b.inTag &&
    a.pendingQuote === b.pendingQuote &&
    a.inCDATA === b.inCDATA &&
    a.pendingRawText === b.pendingRawText &&
    a.scriptEscaped === b.scriptEscaped &&
    a.scriptDoubleEscaped === b.scriptDoubleEscaped &&
    a.foreignContext === b.foreignContext
  )
}

/**
 * Close-free suffix memo for the pairing search: every unmatched opener re-walks the same
 * suffix of html nodes hunting a `</details>` that never comes (quadratic on documents made of
 * unclosed disclosures). After ONE full forward walk, each visited node records the window it
 * scanned to, the window's net depth delta, and the window's minimum cumulative delta — the
 * latter decides which entry counts could possibly resolve inside: a walk carrying count `c`
 * can only resolve where the cumulative delta reaches `-c`, so with
 * `count > -suffixMin` the whole window is skippable in one step. The entry must match the
 * recorded LEXICAL state (lexical regions suppress disclosure tokens, so the delta timeline
 * differs otherwise).
 */
interface CloseScanMemoEntry {
  /** Exclusive node index the recorded walk reached. */
  end: number
  /** Minimum cumulative depth delta across the window, relative to the window's start. */
  suffixMin: number
  /** Net depth delta across the window. */
  suffixTotal: number
  entryState: ContainerScanState
  exitState: ContainerScanState
}

type CloseScanMemo = Map<number, CloseScanMemoEntry>

// Records every visited node of a completed walk (or its fully-scanned prefix before a
// resolving node) as a close-free window. suffixMin/suffixTotal accumulate in reverse so each
// node's window spans from itself to the walk's end.
function recordCloseScanMemo(
  memo: CloseScanMemo,
  visited: Array<{
    index: number
    entryState: ContainerScanState
    exitState: ContainerScanState
    delta: number
    minDelta: number
  }>,
  windowEnd: number
): void {
  let suffixMin = 0
  let suffixTotal = 0
  for (let k = visited.length - 1; k >= 0; k -= 1) {
    const node = visited[k]
    suffixMin = Math.min(node.minDelta, node.delta + suffixMin)
    suffixTotal += node.delta
    memo.set(node.index, {
      end: windowEnd,
      suffixMin,
      suffixTotal,
      entryState: node.entryState,
      exitState: node.exitState
    })
  }
}

// A splice replaces the node at `position` (1:1 — indices survive, contents do not): every
// memo window that spans the position is stale and must go.
function invalidateCloseScanMemo(memo: CloseScanMemo, position: number): void {
  for (const [index, entry] of memo) {
    if (index <= position && position < entry.end) memo.delete(index)
  }
}

/**
 * Match of a NESTED opener, recorded while an enclosing pairing search walks past it: every
 * `<details>` opener whose pairing close the enclosing walk passes gets the close recorded,
 * so the frame that starts at that opener resolves in O(1) instead of re-walking the span the
 * enclosing walk already covered (which made fully paired nesting quadratic). Keyed by the
 * opener NODE: the processing splices replace node objects, so a stale entry misses its key
 * instead of misfiring. `closeIndex` is the close's index in TOP-LEVEL array coordinates —
 * the consuming frame translates by its own array offset and verifies the close by node
 * identity, so any surviving staleness degrades to the ordinary walk (correct, just slower).
 */
interface NestedContainerMatch {
  closeNode: Html
  closeIndex: number
  closeStart: number
  closeEnd: number
}

type NestedContainerMatchTable = Map<Html, NestedContainerMatch>

function findPairedContainerClose(
  children: readonly RootContent[],
  startIndex: number,
  end = children.length,
  closeScanMemo?: CloseScanMemo,
  matchTable?: NestedContainerMatchTable,
  indexOffset?: number
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

  // A match recorded by an enclosing walk jumps straight to the close. Bounds + node identity
  // guard every assumption: a range that excludes the recorded close, a replaced close node or
  // any coordinate drift falls through to the walk below.
  const recorded = matchTable !== undefined && indexOffset !== undefined ? matchTable.get(open) : undefined
  if (recorded !== undefined && indexOffset !== undefined) {
    const closeIndex = recorded.closeIndex - indexOffset
    const closeNode = closeIndex > startIndex && closeIndex < end ? children[closeIndex] : undefined
    if (closeNode !== undefined && closeNode === recorded.closeNode && recorded.closeEnd <= closeNode.value.length) {
      return {
        index: closeIndex,
        closeNode,
        closeStart: recorded.closeStart,
        closeEnd: recorded.closeEnd,
        retainedOpens,
        bodyEntryState
      }
    }
  }

  // Visited-node log of the current walk, fed to the close-free suffix memo when the walk
  // completes (or when it resolves: the fully-scanned prefix is still a close-free window).
  const visited: Array<{
    index: number
    entryState: ContainerScanState
    exitState: ContainerScanState
    delta: number
    minDelta: number
  }> = []
  // Openers whose closes this walk passes, innermost last. The CALLED opener is absent (its
  // own open lives in the opening node scanned above): a close arriving with the stack empty
  // closes one of the caller's own retained opens and records nothing.
  const pendingOpeners: Html[] = []
  // A node holding SEVERAL openers gets no match — an entry keyed by the shared node could
  // not tell a consumer at that node which opener's close it needs.
  const ambiguousOpeners = new Set<Html>()
  for (let index = startIndex + 1; index < end; index += 1) {
    const child = children[index]
    if (child?.type !== 'html') continue
    const memoEntry = closeScanMemo?.get(index)
    if (
      memoEntry !== undefined &&
      memoEntry.end <= end &&
      sameScanLexicalState(state, memoEntry.entryState) &&
      // A walk carrying `count` resolves only where the cumulative delta reaches `-count`;
      // with the window's minimum delta above that, nothing inside can resolve — skip whole.
      state.count > -memoEntry.suffixMin
    ) {
      // The skipped span joins the visited log as one synthetic node, so a later reverse
      // recording (this walk may still resolve further down) folds the span's exact delta
      // minimum into its recorded windows instead of skipping over it. Openers inside the
      // skipped span record no match — their consumers walk, and their walks share this
      // memo's window instead.
      const entryState: ContainerScanState = { ...state }
      const newCount = state.count + memoEntry.suffixTotal
      copyScanLexicalState(state, memoEntry.exitState)
      state.count = newCount
      visited.push({
        index,
        entryState,
        exitState: { ...state },
        delta: memoEntry.suffixTotal,
        minDelta: memoEntry.suffixMin
      })
      index = memoEntry.end - 1 // the loop increment lands on the window's end
      continue
    }
    const entryState: ContainerScanState = { ...state }
    const countMin: { value: number } = { value: state.count }
    let tokenSink: ContainerTokenSink | undefined
    if (matchTable !== undefined && indexOffset !== undefined) {
      const table = matchTable
      const offset = indexOffset
      tokenSink = (isOpen, tokenStart, tokenEnd) => {
        if (isOpen) {
          pendingOpeners.push(child)
          return
        }
        const openerNode = pendingOpeners.pop()
        if (openerNode === undefined) return
        const below = pendingOpeners[pendingOpeners.length - 1]
        if (below === openerNode || ambiguousOpeners.has(openerNode)) {
          ambiguousOpeners.add(openerNode)
          return
        }
        table.set(openerNode, {
          closeNode: child,
          closeIndex: offset + index,
          closeStart: tokenStart,
          closeEnd: tokenEnd
        })
      }
    }
    const scan = scanContainerBoundaries(child.value, state, true, countMin, tokenSink)
    visited.push({
      index,
      entryState,
      exitState: { ...state },
      delta: state.count - entryState.count,
      minDelta: countMin.value - entryState.count
    })
    if (scan.closed) {
      if (closeScanMemo !== undefined) recordCloseScanMemo(closeScanMemo, visited, index)
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
  if (closeScanMemo !== undefined) recordCloseScanMemo(closeScanMemo, visited, end)
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

  // One pending range of the paired-container traversal. The traversal is ITERATIVE over a
  // stack of frames: processing a matched body used to recurse once per nesting level, and a
  // fully paired disclosure chain exhausted the JavaScript call stack at message-sized depths
  // (~2,400 levels in 55KB). Pausing pushes the body's frame on top of the paused one, and the
  // driver below runs it to completion before resuming — LIFO order replaces the recursion.
  interface ProcessRangeFrame {
    /** The range's nodes: a slice of the parent frame's array, plus at most one prefix node
     * appended at the end. Every mutation inside is a 1:1 splice, so indices stay stable. */
    items: RootContent[]
    from: number
    to: number
    /** Next node index the loop processes. */
    index: number
    /** This array's index 0 in top-level array coordinates, translating nested-match close
     * indices into local ones. `undefined` for the synthetic single-node prefix ranges, whose
     * nodes belong to no array. */
    indexOffset: number | undefined
    /** Closes still owed to openings retained in an enclosing shared opening node. */
    pendingCloses: number
    // Lexical state for resolving retained closes across the range's html nodes: depth 1 means
    // "the next unmatched close is the retained one" — it re-arms only AFTER a resolution, so
    // the depth the range's own nested openings accumulate survives between resolutions.
    pendingScanState: ContainerScanState
    // Lexical state of the stream at the CURRENT node's start, carried across the range's html
    // nodes. A node reached inside a raw-text body, comment, dangling tag or CDATA section is
    // literal text: its `<details>`/`<html>` are never markup, so it must not start a pairing
    // search or a document artifact — a fresh scan would treat a textarea literal as a real
    // opener and consume the next disclosure's close. Only the lexical fields matter here;
    // disclosure depth is tracked by the pairing/pending scans themselves.
    streamState: ContainerScanState
    // Close-free windows for THIS range's array instance: pairing searches from successive
    // unmatched openers share their fruitless suffix walks through it. Indices are stable —
    // every splice below replaces one node 1:1 — and each splice invalidates the windows that
    // span the replaced position.
    closeScanMemo: CloseScanMemo
    /** Set while a nested body frame runs: the close emission the loop still owes. */
    resume?: {
      closeNode: Html
      closeStart: number
      closeEnd: number
      /** The close node's index in THIS frame's array. */
      closeIndex: number
      remainderStart: number | undefined
      /** Whether the close resolves a retained opening (pending-close bookkeeping) or a
       * paired container boundary (plain lexical reset). */
      retained: boolean
    }
  }

  // Nested matches recorded by every walk, shared by every frame (see NestedContainerMatchTable).
  const nestedMatches: NestedContainerMatchTable = new Map()
  const stack: ProcessRangeFrame[] = []
  const pushRangeFrame = (
    items: RootContent[],
    from: number,
    to: number,
    retainedOpens: number,
    entryState: ContainerScanState | undefined,
    indexOffset: number | undefined
  ): void => {
    stack.push({
      items,
      from,
      to,
      index: from,
      indexOffset,
      pendingCloses: retainedOpens,
      pendingScanState: entryState ? { ...entryState, count: 1 } : { count: 1 },
      streamState: entryState ? { ...entryState, count: 0 } : { count: 0 },
      closeScanMemo: new Map()
    })
  }

  pushRangeFrame(tree.children, 0, tree.children.length, 0, undefined, 0)
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const { items, to, closeScanMemo, streamState, pendingScanState } = frame
    if (frame.resume !== undefined) {
      const { closeNode, closeStart, closeEnd, closeIndex, remainderStart, retained } = frame.resume
      frame.resume = undefined
      children.push(sliceHtmlNode(closeNode, closeStart, closeEnd))
      if (retained) {
        frame.pendingCloses -= 1
        frame.pendingScanState.count = 1
      }
      // At the close the lexical stream is plain: the scan could only resolve a real
      // `</details>` boundary once every raw-text body, comment, tag and CDATA section ended.
      resetStreamState(frame.streamState)
      if (remainderStart !== undefined) {
        // The NEXT disclosure's opening after the boundary (`</details>` and `<details>` merge
        // into one html block when no blank line separates them) re-enters pairing as a fresh
        // open. Leading whitespace on the remainder is insignificant inside the html block.
        items.splice(closeIndex, 1, sliceHtmlNode(closeNode, remainderStart, closeNode.value.length))
        invalidateCloseScanMemo(closeScanMemo, closeIndex)
        frame.index = closeIndex // the loop increment lands on the remainder
      } else {
        // Resuming re-enters the node loop without the increment a `continue` would have
        // applied, so skipping the emitted close lands one PAST it.
        frame.index = closeIndex + 1
      }
      continue
    }
    let paused = false
    for (; frame.index < to; frame.index += 1) {
      const index = frame.index
      const pendingCloses = frame.pendingCloses
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
              invalidateCloseScanMemo(closeScanMemo, documentEndIndex)
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
        frame.index = resumeIndex
        continue
      }

      const paired = insideLiteralRegion
        ? undefined
        : findPairedContainerClose(items, index, to, closeScanMemo, nestedMatches, frame.indexOffset)
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
        // The state the body scan continues from: the opening node's tail state, unless the
        // summary node's remainder (scanned below) leaves the stream inside a lexical region —
        // the body's first nodes continue THAT stream, so its state rides along with the
        // remainder's open count.
        let bodyEntryState = paired.bodyEntryState
        // CommonMark gives a leading comment (or doctype/PI) its own html node before the
        // summary label: metadata-only nodes carry no label, so locate the summary beyond them
        // — a body[0]-only check would swallow the label into the artifact and leave the native
        // disclosure without its summary. When NO summary follows, the metadata stays in the
        // body range: the document assembly (and the artifact paths) already skip it to find
        // the document start, and emitting it early would strand a bare node outside the
        // artifact.
        let labelIndex = 0
        for (let head = 0; head < body.length; head += 1) {
          const node = body[head]
          if (node?.type !== 'html' || !isHtmlMetadataOnly(node)) break
          labelIndex = head + 1
        }
        const firstBody = body[labelIndex]
        if (firstBody?.type === 'html' && HTML_SUMMARY_OPEN_REGEX.test(stripLeadingHtmlMetadata(firstBody.value))) {
          // The skipped metadata nodes are insignificant inside the html block and inert
          // (complete comments/doctype/PI): emit them raw ahead of the raw label.
          for (let head = 0; head < labelIndex; head += 1) {
            const node = body[head]
            if (node) children.push(node)
          }
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
              body[labelIndex] = sliceHtmlNode(firstBody, openerStart, firstBody.value.length)
              bodyStart = labelIndex
            } else {
              children.push(firstBody)
              bodyStart = labelIndex + 1
              // Body content before any opener (`<div>…`) voids the opener search above, but
              // the remainder can still OPEN disclosures: count them (scratch state only) so
              // the body range keeps their closes raw. The scan's LEXICAL state (a raw-text
              // body, dangling comment/tag or CDATA the remainder opened) must ride along too:
              // the body's first nodes continue that stream, and a literal close the region
              // holds must not resolve as a retained boundary.
              const remainderState: ContainerScanState = { ...paired.bodyEntryState, count: 0 }
              scanContainerBoundaries(rest, remainderState)
              remainderOpens = remainderState.count
              bodyEntryState = remainderState
            }
          } else {
            // The label's open tag never completed in this node (streaming): keep the whole
            // node raw, as before the split existed.
            children.push(firstBody)
            bodyStart = labelIndex + 1
          }
        }
        // Without a summary, bodyStart stays 0: the metadata-only nodes remain in the body
        // range and the document assembly (which skips them to find the document start) keeps
        // them inside the artifact.
        // The paired close closes the outermost opening of the opening node; every opening
        // retained next to it has no matching open inside the body, so its close arrives as an
        // unpaired body node and must stay raw (see the fallback below). The body range runs
        // as its own frame; this frame pauses and finishes the close emission (plus the
        // remainder splice below) once the body frame completes — the stack order replaces
        // the recursion that exhausted the call stack on deep nesting.
        const rest = closeNode.value.slice(paired.closeEnd)
        frame.resume = {
          closeNode,
          closeStart: paired.closeStart,
          closeEnd: paired.closeEnd,
          closeIndex: paired.index,
          remainderStart:
            paired.closeEnd < closeNode.value.length
              ? paired.closeEnd + (rest.length - rest.trimStart().length)
              : undefined,
          retained: false
        }
        pushRangeFrame(
          body,
          bodyStart,
          body.length,
          Math.max(paired.retainedOpens - 1, 0) + remainderOpens,
          bodyEntryState,
          frame.indexOffset === undefined ? undefined : frame.indexOffset + index + 1
        )
        paused = true
        break
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
          // Content preceding the boundary keeps the normal path as its own frame (a shared
          // close prefix): it continues the lexical stream as of BEFORE this node — a raw-text
          // body opened in an earlier body node holds the prefix's own literals, so a fresh
          // scan would fire on them and emit a stray raw close. The stack order runs the
          // prefix frame before this frame's close emission, like the recursion did.
          if (close.start > 0) {
            const rest = child.value.slice(close.end)
            frame.resume = {
              closeNode: child,
              closeStart: close.start,
              closeEnd: close.end,
              closeIndex: index,
              remainderStart:
                close.end < child.value.length ? close.end + (rest.length - rest.trimStart().length) : undefined,
              retained: true
            }
            pushRangeFrame(
              [sliceHtmlNode(child, 0, close.start)],
              0,
              1,
              frame.pendingCloses,
              stateBeforeNode,
              undefined
            )
            paused = true
            break
          }
          children.push(sliceHtmlNode(child, close.start, close.end))
          frame.pendingCloses -= 1
          frame.pendingScanState.count = 1
          // The resolved close is a real boundary: the lexical stream is plain after it.
          resetStreamState(streamState)
          if (close.end < child.value.length) {
            // Adjacent content (`</details>` and a new `<details>` merge into one html block)
            // re-enters pairing as a fresh open. Leading whitespace on the remainder is
            // insignificant inside the html block.
            const rest = child.value.slice(close.end)
            const remainderStart = close.end + (rest.length - rest.trimStart().length)
            items.splice(index, 1, sliceHtmlNode(child, remainderStart, child.value.length))
            invalidateCloseScanMemo(closeScanMemo, index)
            frame.index = index - 1 // the loop increment lands on the remainder
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
    // The frame finished its range only when the loop ran to the end; a pause left it on the
    // stack to resume after the nested frame above it completes.
    if (!paused) stack.pop()
  }

  tree.children = children
}
