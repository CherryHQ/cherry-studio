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
 */

const CLOSER = '**'
// Only trust the cut when prose resumes right after the markers; a URL-shaped continuation
// (`/a/**/b`) means the stars are likely part of the path, so we keep the spec behavior.
const PROSE_BOUNDARY_REGEX = /[\s`\p{P}]/u

interface FixPlan {
  parent: Parent
  startIndex: number
  removeCount: number
  nodes: RootContent[]
}

function isSwallowedLiteralAutolink(node: Link): node is Link & { children: [Text] } {
  if (node.children.length !== 1 || node.children[0].type !== 'text') return false
  const value = node.children[0].value
  return node.url.includes(CLOSER) && (value === node.url || node.url === `http://${value}`)
}

function findCutIndex(node: Link): number | undefined {
  const cut = node.url.indexOf(CLOSER)
  if (cut === -1) return undefined
  const after = node.url[cut + CLOSER.length]
  return after === undefined || PROSE_BOUNDARY_REGEX.test(after) ? cut : undefined
}

// `<https://a.com/x**b>` also satisfies text === url, but there the stars are intentional.
function startsAsAngleAutolink(source: string, node: Link): boolean {
  const offset = node.position?.start.offset
  return offset === undefined || source[offset] === '<'
}

function parseInlineTail(value: string): PhrasingContent[] {
  const tree = unified().use(remarkParse).parse(value) as Root
  const nodes = tree.children.flatMap((child) => (child.type === 'paragraph' ? child.children : []))
  // Positions from the sub-parse point into the tail substring, not the source document.
  for (const node of nodes) {
    delete node.position
    if ('children' in node) for (const child of node.children) delete (child as Text).position
  }
  return nodes
}

function buildFix(node: Link, index: number, parent: Parent, source: string): FixPlan | undefined {
  const { url } = node
  if (!isSwallowedLiteralAutolink(node) || startsAsAngleAutolink(source, node)) return undefined
  const cut = findCutIndex(node)
  if (cut === undefined) return undefined

  const text = node.children[0]
  // The www form carries an `http://` prefix on the url only, so mirror the cut onto the text.
  const fixedUrl = url.slice(0, cut)
  const fixedValue = text.value.slice(0, cut - (url.length - text.value.length))

  node.url = fixedUrl
  text.value = fixedValue
  // The old span covers the swallowed run, which no longer belongs to this node.
  delete node.position

  const tailNodes = parseInlineTail(url.slice(cut + CLOSER.length))
  const prev = parent.children[index - 1]
  const prevText = prev?.type === 'text' ? (prev as Text) : undefined
  if (prevText?.value.endsWith(CLOSER)) {
    const strong: Strong = { type: 'strong', children: [node] }
    const head: RootContent[] = []
    const opener = prevText.value.slice(0, prevText.value.length - CLOSER.length)
    if (opener) head.push({ type: 'text', value: opener })
    head.push(strong)
    // Splice covers the opener too so the trimmed text replaces it in one step.
    return { parent, startIndex: index - 1, removeCount: 2, nodes: [...head, ...tailNodes] }
  }

  return { parent, startIndex: index, removeCount: 1, nodes: [node, ...tailNodes] }
}

export const remarkLiteralAutolinkFix: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file)
  const plans: FixPlan[] = []

  visit(tree, 'link', (node, index, parent) => {
    if (!parent || typeof index !== 'number') return
    const plan = buildFix(node as Link, index, parent, source)
    if (plan) plans.push(plan)
  })

  for (const plan of plans.reverse()) {
    plan.parent.children.splice(plan.startIndex, plan.removeCount, ...plan.nodes)
  }
}
