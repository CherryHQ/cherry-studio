import type { Link, PhrasingContent, Root, RootContent, Strong, Text } from 'mdast'
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
 * The repair only fires when an emphasis opener (`**`) sits immediately before the link — a
 * signal the markers were meant as emphasis. Links without one keep spec behavior.
 */

const CLOSER = '**'
// When these follow the closing markers the stars likely continue the URL
// (scheme/port/query/path), so we leave the link alone; anything else — letters, CJK,
// punctuation, whitespace, end of text — counts as prose resuming.
const URL_CONTINUATION_REGEX = /^[/:#?&=%@+~]/

interface FixPlan {
  parent: Parent
  startIndex: number
  removeCount: number
  nodes: RootContent[]
}

const tailProcessor = unified().use(remarkParse)

function stripPositions(nodes: PhrasingContent[]): void {
  for (const node of nodes) {
    delete node.position
    if ('children' in node) stripPositions(node.children)
  }
}

// Parsed without GFM on purpose: tails are short prose fragments and this keeps us off a
// renderer-only dependency; CommonMark still preserves backticks and nested text.
function parseInlineTail(value: string): PhrasingContent[] {
  const tree = tailProcessor.parse(value)
  const nodes = tree.children.flatMap((child) => (child.type === 'paragraph' ? child.children : []))
  stripPositions(nodes)
  return nodes
}

function isSwallowedLiteralAutolink(node: Link): node is Link & { children: [Text] } {
  if (node.children.length !== 1 || node.children[0].type !== 'text') return false
  const value = node.children[0].value
  return node.url.includes(CLOSER) && (value === node.url || node.url === `http://${value}`)
}

// The swallowed closer is the LAST marker run before prose resumes; earlier runs may be part
// of the path (`https://x.com/a/**/b`). Scan backwards until one is followed by non-URL text.
function findCloserIndex(url: string): number | undefined {
  let index = url.lastIndexOf(CLOSER)
  while (index > 0) {
    const after = url[index + CLOSER.length]
    if (after === undefined || !URL_CONTINUATION_REGEX.test(after)) return index
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

  const cut = findCloserIndex(node.url)
  if (cut === undefined) return undefined

  const text = node.children[0]
  // Mirror the cut independently on the label; www-form urls carry an `http://` prefix the
  // text lacks, so deriving it arithmetically could underflow into a wrapped slice.
  const textCut = text.value.lastIndexOf(CLOSER)
  if (textCut <= 0) return undefined

  const tailNodes = parseInlineTail(node.url.slice(cut + CLOSER.length))
  node.url = node.url.slice(0, cut)
  text.value = text.value.slice(0, textCut)
  // The old span covers the swallowed run, which no longer belongs to this node.
  delete node.position

  const strong: Strong = { type: 'strong', children: [node] }
  const head: RootContent[] = []
  const lead = opener.value.slice(0, opener.value.length - CLOSER.length)
  if (lead) head.push({ type: 'text', value: lead })
  head.push(strong)
  // Splice covers the opener too so the trimmed text replaces it in one step.
  return { parent, startIndex: index - 1, removeCount: 2, nodes: [...head, ...tailNodes] }
}

export const remarkLiteralAutolinkFix: Plugin<[], Root> = () => (tree, file) => {
  if (!String(file).includes(CLOSER)) return tree

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
