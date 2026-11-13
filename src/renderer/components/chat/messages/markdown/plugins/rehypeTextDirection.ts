import type { Element, Root } from 'hast'
import type { Plugin } from 'unified'

import { textDirection } from '@renderer/utils/textDirection'

// Runs after sanitize (appended via ChatMarkdownRuntime extra rehype plugins),
// so the explicit `dir` we set is never stripped by the sanitize schema.
// Text inside code and links is excluded from the vote.
const BLOCK_TAGS = new Set([
  'p',
  'li',
  'blockquote',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dt',
  'dd',
  'figcaption',
  'summary'
])

const SKIP_TAGS = new Set(['a', 'code', 'math', 'pre', 'script', 'style', 'svg'])

// Block containers own their text independently: when voting for a parent
// block, only its own inline prose counts, not nested lists or quotes.
const NESTED_CONTAINER_TAGS = new Set(['blockquote', 'li', 'ol', 'ul'])

function collectText(node: Element | Root): string {
  let text = ''

  for (const child of node.children) {
    if (child.type === 'text') {
      text += child.value
      continue
    }
    if (child.type !== 'element' || SKIP_TAGS.has(child.tagName) || NESTED_CONTAINER_TAGS.has(child.tagName)) continue
    text += collectText(child)
  }

  return text
}

// Nested blocks (e.g. `li > p`) are handled by recursing into children first,
// then the parent block: a paragraph's own dir wins over an ancestor's.
function applyDirection(node: Element | Root): void {
  for (const child of node.children) {
    if (child.type !== 'element' || SKIP_TAGS.has(child.tagName)) continue

    applyDirection(child)

    if (!BLOCK_TAGS.has(child.tagName) || child.properties?.dir !== undefined) continue

    const direction = textDirection(collectText(child))
    if (direction !== 'auto') child.properties = { ...child.properties, dir: direction }
  }
}

export const rehypeTextDirection: Plugin<[], Root> = () => {
  return (tree) => {
    applyDirection(tree)
  }
}
