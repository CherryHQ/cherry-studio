import type { Link, Paragraph, PhrasingContent, Root, RootContent, Strong, Text } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import type { Plugin } from 'unified'
import { unified } from 'unified'
import type { Parent } from 'unist'
import { visit } from 'unist-util-visit'

/**
 * Repairs literal autolinks that swallowed adjacent emphasis markers. remark-gfm's autolink
 * extends a bare URL through any following non-whitespace run unless it is entirely strippable
 * punctuation, so `**https://a.com/x**（中文）` keeps `**（中文）` inside the href — bold lost,
 * link dead. GitHub's own renderer behaves identically (verified against api.github.com/markdown),
 * so this is a deliberate deviation from spec behavior: we re-pair the emphasis the way marked —
 * the Notes editor engine — does, because model output hits this shape often enough that a dead
 * link outweighs spec conformance.
 *
 * Two gates keep explicit syntax safe: the link must originate from a literal autolink (link and
 * label share their first source character; angle/explicit links include their delimiter in the
 * span), and an emphasis opener must hug the link. Either check failing — including missing
 * position data — leaves the node untouched.
 *
 * Scope: only `**` (strong) is repaired. Single-matcher star (`*`) swallows identically but is
 * left alone because a bare `*` is a valid URL character, making the boundary unresolvable;
 * underscore emphasis (`_`/`__`) is not swallowed by remark-gfm at all and needs no repair.
 */

const CLOSER = '**'
// Caps the chained-tail recursion on adversarially long chains (each repaired link spends 1);
// over-budget links keep their GFM shape — content is never dropped. Real citation lists stay
// far below this.
const MAX_TAIL_REPAIRS = 50
// Chars after the markers that continue a URL (scheme/port/query/path/extension); anything
// else — letters, CJK, brackets, whitespace, EOF — is prose resuming.
const URL_CONTINUATION_REGEX = /^[/:#?&=%@+~.\-_]/

interface FixPlan {
  parent: Parent
  startIndex: number
  removeCount: number
  nodes: RootContent[]
}

// Shares the document pipeline so a second URL inside a tail stays clickable.
const tailProcessor = unified().use(remarkParse).use(remarkGfm)

function stripPositions(nodes: PhrasingContent[]): void {
  for (const node of nodes) {
    delete node.position
    if ('children' in node) stripPositions(node.children)
  }
}

function parseInlineTail(value: string): PhrasingContent[] {
  const tree = tailProcessor.parse(value)
  const paragraphs = tree.children.filter((child): child is Paragraph => child.type === 'paragraph')
  // Positions are kept for now — the origin gate needs them — and stripped by
  // `repairTailNodes` once the (possibly chained) repairs are done.
  return paragraphs.length === tree.children.length
    ? paragraphs.flatMap((child) => child.children)
    : // Structural content (list/quote/code) is vanishingly rare in a swallowed tail; degrade
      // to the plain text so no user-visible suffix is dropped.
      [{ type: 'text', value }]
}

function isSwallowedLiteralAutolink(node: Link): node is Link & { children: [Text] } {
  if (node.children.length !== 1 || node.children[0].type !== 'text') return false
  const value = node.children[0].value
  const isWww = node.url === `http://${value}` || node.url === `https://${value}`
  if (!node.url.includes(CLOSER) || (value !== node.url && !isWww)) return false
  // Literal autolinks are built from one contiguous slice, so link and label start together;
  // angle (`<...>`) and explicit (`[..](..)`) links carry their delimiter in the link span.
  const linkStart = node.position?.start.offset
  return linkStart !== undefined && linkStart === node.children[0].position?.start.offset
}

// Cut at the FIRST boundary run — earlier runs are URL continuations (`/a/**/b`) and a chained
// tail is repaired recursively by the caller. `indexOf` strictly increases, so no looping.
function findCloserRun(url: string): { start: number; tailStart: number } | undefined {
  let index = url.indexOf(CLOSER)
  while (index >= 0) {
    const after = url[index + CLOSER.length]
    if (after === undefined || !URL_CONTINUATION_REGEX.test(after)) {
      let start = index
      while (start > 0 && url[start - 1] === '*') start--
      let tailStart = index + CLOSER.length
      while (tailStart < url.length && url[tailStart] === '*') tailStart++
      return { start, tailStart }
    }
    index = url.indexOf(CLOSER, index + 1)
  }
  return undefined
}

interface Cut {
  url: string
  text: string
  tail: string
}

// Cut href and label with the same scan so they never diverge; also returns the residual tail.
function computeCut(node: Link & { children: [Text] }): Cut | undefined {
  const closer = findCloserRun(node.url)
  if (!closer) return undefined
  const text = node.children[0]
  const textRun = findCloserRun(text.value)
  if (!textRun || textRun.start <= 0) return undefined
  return {
    url: node.url.slice(0, closer.start),
    text: text.value.slice(0, textRun.start),
    tail: node.url.slice(closer.tailStart)
  }
}

// Repair one flat inline sequence for chains of back-to-back bolded urls: cut, wrap in
// strong, recurse on the tail. The escape check uses the tail substring as its own source.
// `budget` spends one per repaired link; over-budget links keep their GFM shape.
function repairTailNodes(nodes: PhrasingContent[], tailSource: string, budget = MAX_TAIL_REPAIRS): PhrasingContent[] {
  const repaired: PhrasingContent[] = []
  for (const node of nodes) {
    if (node.type === 'link' && isSwallowedLiteralAutolink(node)) {
      const prev = repaired[repaired.length - 1]
      const opener = toTextNode(prev)
      const openerSource =
        opener?.position && tailSource.slice(opener.position.start.offset, opener.position.end.offset)
      if (
        budget > 0 &&
        opener &&
        openerSource &&
        opener.value.endsWith(CLOSER) &&
        openerHasLiteralMarkers(opener, openerSource)
      ) {
        const cut = computeCut(node)
        if (cut) {
          const text = node.children[0]
          node.url = cut.url
          text.value = cut.text
          delete node.position
          delete text.position
          const lead = opener.value.replace(/\*{2,}$/, '')
          if (lead) {
            opener.value = lead
          } else {
            repaired.pop()
          }
          const strong: Strong = { type: 'strong', children: [node] }
          repaired.push(strong)
          repaired.push(...repairTailNodes(parseInlineTail(cut.tail), cut.tail, budget - 1))
          continue
        }
      }
    }
    repaired.push(node)
  }
  // Positions from the sub-parse point into the tail substring, not the source document.
  stripPositions(repaired)
  return repaired
}

// An extractor instead of an assertion: the compiler and type-aware linter resolve the mdast/unist
// union differently, so a direct `as Text` at the call site trips one toolchain or the other.
function toTextNode(node: unknown): Text | undefined {
  if (typeof node === 'object' && node !== null && 'type' in node && (node as { type: string }).type === 'text') {
    return node as Text
  }
  return undefined
}

// True when the opener's trailing markers are literal, unescaped `*` characters in the raw
// source span — present as stars (a character reference like `&ast;` leaves the span short of
// stars) and not preceded by an odd backslash run (`\**`). Anything else fails closed.
function openerHasLiteralMarkers(opener: Text, spanSource: string): boolean {
  let spanStars = 0
  while (spanStars < spanSource.length && spanSource[spanSource.length - 1 - spanStars] === '*') {
    spanStars++
  }
  let valueStars = 0
  while (valueStars < opener.value.length && opener.value[opener.value.length - 1 - valueStars] === '*') {
    valueStars++
  }
  if (spanStars < valueStars) return false
  // Count the backslash run immediately before the stars; an odd run escapes them.
  let slashes = 0
  while (slashes < spanSource.length - spanStars && spanSource[spanSource.length - spanStars - slashes - 1] === '\\') {
    slashes++
  }
  return slashes % 2 === 0
}

function buildFix(node: Link, index: number, parent: Parent, source: string): FixPlan | undefined {
  if (!isSwallowedLiteralAutolink(node)) return undefined
  // Without an opener hugging the link there is no evidence the stars were emphasis, and an
  // escaped run (`\**`) must not be consumed even when its rendered value looks like markers.
  const prev = parent.children[index - 1]
  const opener = toTextNode(prev)
  if (!opener?.value.endsWith(CLOSER)) return undefined
  // Reject a run whose marker is escaped (`\**`, `\*\*`); a backslash or character reference
  // earlier in the span (`\\**`, `\q**`, `&amp;**`) must not disqualify real emphasis.
  const openerSource = opener.position && source.slice(opener.position.start.offset, opener.position.end.offset)
  if (!openerSource || !openerHasLiteralMarkers(opener, openerSource)) return undefined

  const cut = computeCut(node)
  if (!cut) return undefined

  const text = node.children[0]
  node.url = cut.url
  text.value = cut.text
  // Both spans covered the swallowed run, which no longer belongs to either node.
  delete node.position
  delete text.position

  const tailNodes = repairTailNodes(parseInlineTail(cut.tail), cut.tail)

  const strong: Strong = { type: 'strong', children: [node] }
  const head: RootContent[] = []
  // Consume the opener's full run too, so `***url***` does not leave stray stars behind.
  const lead = opener.value.replace(/\*{2,}$/, '')
  if (lead) head.push({ type: 'text', value: lead })
  head.push(strong)
  // Splice covers the opener too so the trimmed text replaces it in one step.
  return { parent, startIndex: index - 1, removeCount: 2, nodes: [...head, ...tailNodes] }
}

export const remarkLiteralAutolinkFix: Plugin<[], Root> = () => (tree, file) => {
  // VFile.frozen may not hold value; read it explicitly rather than relying on toString.
  const source = typeof file.value === 'string' ? file.value : String(file)
  if (!source.includes(CLOSER)) return tree

  const plans: FixPlan[] = []

  visit(tree, 'link', (node, index, parent) => {
    if (!parent || typeof index !== 'number') return
    const plan = buildFix(node, index, parent, source)
    if (plan) plans.push(plan)
  })

  for (const plan of plans.reverse()) {
    plan.parent.children.splice(plan.startIndex, plan.removeCount, ...plan.nodes)
  }

  return tree
}
