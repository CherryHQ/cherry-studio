import type { Link, PhrasingContent, Root, RootContent, Strong, Text } from 'mdast'
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
  const nodes = tree.children.flatMap((child) => (child.type === 'paragraph' ? child.children : []))
  // Positions from the sub-parse point into the tail substring, not the source document.
  stripPositions(nodes)
  return nodes
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

// The swallowed closer is the last marker run before prose resumes; earlier runs may be part
// of the path (`https://x.com/a/**/b`). Scan backwards until one is followed by non-URL text.
function findCloserRun(url: string): { start: number; tailStart: number } | undefined {
  let index = url.lastIndexOf(CLOSER)
  while (index > 0) {
    const after = url[index + CLOSER.length]
    if (after === undefined || !URL_CONTINUATION_REGEX.test(after)) {
      let start = index
      while (start > 0 && url[start - 1] === '*') start--
      return { start, tailStart: index + CLOSER.length }
    }
    index = url.lastIndexOf(CLOSER, index - 1)
  }
  return undefined
}

function buildFix(node: Link, index: number, parent: Parent): FixPlan | undefined {
  if (!isSwallowedLiteralAutolink(node)) return undefined
  // Without an opener hugging the link there is no evidence the stars were emphasis.
  const prev = parent.children[index - 1]
  const opener = prev?.type === 'text' ? (prev as Text) : undefined
  if (!opener?.value.endsWith(CLOSER)) return undefined

  const closer = findCloserRun(node.url)
  if (!closer) return undefined

  const text = node.children[0]
  // Mirror the cut on the label independently (www-form urls carry an `http://` prefix the
  // text lacks) and back up to the whole marker run so longer runs leave no stray stars.
  let textCut = text.value.lastIndexOf(CLOSER)
  if (textCut <= 0) return undefined
  while (textCut > 0 && text.value[textCut - 1] === '*') textCut--

  const tailNodes = parseInlineTail(node.url.slice(closer.tailStart))
  node.url = node.url.slice(0, closer.start)
  text.value = text.value.slice(0, textCut)
  // Both spans covered the swallowed run, which no longer belongs to either node.
  delete node.position
  delete text.position

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
    const plan = buildFix(node, index, parent)
    if (plan) plans.push(plan)
  })

  for (const plan of plans.reverse()) {
    plan.parent.children.splice(plan.startIndex, plan.removeCount, ...plan.nodes)
  }

  return tree
}
