import rehypeParse from 'rehype-parse'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import rehypeHeadingIds, { extractTextFromNode } from '../../plugins/rehype-heading-ids'

describe('heading text extraction', () => {
  it('reads inline formatting and code from Markdown outline nodes', () => {
    const tree = unified().use(remarkParse).parse('## Hello *world* `x`')

    expect(extractTextFromNode(tree.children[0])).toBe('Hello world x')
  })

  it('uses the same inline text for rendered heading anchors', () => {
    const tree = unified().use(rehypeParse, { fragment: true }).parse('<h2>Hello <em>world</em> <code>x</code></h2>')

    unified().use(rehypeHeadingIds, { prefix: 'heading-message' }).runSync(tree)

    const heading = tree.children[0]
    expect(extractTextFromNode(heading)).toBe('Hello world x')
    if (heading.type !== 'element') throw new Error('Expected the parsed heading element')
    expect(heading.properties.id).toBe('heading-message--hello-world-x')
  })
})
