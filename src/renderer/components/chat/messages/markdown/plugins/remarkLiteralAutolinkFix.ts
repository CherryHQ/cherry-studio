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
// When these follow the closing markers the stars likely continue the URL
// (scheme/port/query/path/extension — note `.`, `-`, `_`), so we leave the link alone;
// anything else — letters, CJK, brackets, whitespace, end of text — is prose resuming.
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

// The swallowed closer is the FIRST marker run followed by non-URL text. Earlier runs in the
// path (`https://x.com/a/**/b`) are skipped as URL continuations; in a chained shape
// (`…x**(y)**https://b.com/z**`) the first boundary run ends the href and hands the rest to
// the tail, which is itself repaired recursively. `indexOf` strictly increases, so the scan
// cannot loop.
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

// Compute the href/label cuts plus the residual tail. The label is cut with the exact same
// scan so it never diverges from the href (www labels only differ by the scheme prefix, which
// neither scan depends on).
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

// Repair a flat inline sequence in place (used for a tail that may itself contain another
// swallowed `**url**`): find a swallowed link preceded by a marker-ending text, cut it, wrap
// it in strong, and recurse on the remainder. Tail nodes carry positions into the tail
// substring, so the escaped-opener check is skipped here — false positives are both rare and
// fail closed.
function repairTailNodes(nodes: PhrasingContent[]): PhrasingContent[] {
  const repaired: PhrasingContent[] = []
  for (const node of nodes) {
    if (node.type === 'link' && isSwallowedLiteralAutolink(node)) {
      const prev = repaired[repaired.length - 1]
      const opener = toTextNode(prev)
      if (opener?.value.endsWith(CLOSER)) {
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
          repaired.push(...repairTailNodes(parseInlineTail(cut.tail)))
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

// An extractor instead of an assertion: tsgo and typescript-eslint resolve the mdast/unist
// union differently, so a direct `as Text` at the call site trips one toolchain or the other.
function toTextNode(node: unknown): Text | undefined {
  if (typeof node === 'object' && node !== null && 'type' in node && (node as { type: string }).type === 'text') {
    return node as Text
  }
  return undefined
}

function buildFix(node: Link, index: number, parent: Parent, source: string): FixPlan | undefined {
  if (!isSwallowedLiteralAutolink(node)) return undefined
  // Without an opener hugging the link there is no evidence the stars were emphasis, and an
  // escaped run (`\**`) must not be consumed even when its rendered value looks like markers.
  const prev = parent.children[index - 1]
  const opener = toTextNode(prev)
  if (!opener?.value.endsWith(CLOSER)) return undefined
  // Reject a run whose marker at the end of its source span is escaped (`\**`) — escaped stars
  // render as `**` but are literal text, not emphasis. Only that exact case; a backslash or
  // character reference earlier in the span (`\q**`, `&amp;**`) must not disqualify real emphasis.
  const openerSource = opener.position && source.slice(opener.position.start.offset, opener.position.end.offset)
  if (!openerSource) return undefined
  let starCount = 0
  while (starCount < openerSource.length && openerSource[openerSource.length - 1 - starCount] === '*') starCount++
  if (openerSource[openerSource.length - 1 - starCount] === '\\') return undefined

  const cut = computeCut(node)
  if (!cut) return undefined

  const text = node.children[0]
  node.url = cut.url
  text.value = cut.text
  // Both spans covered the swallowed run, which no longer belongs to either node.
  delete node.position
  delete text.position

  const tailNodes = repairTailNodes(parseInlineTail(cut.tail))

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
