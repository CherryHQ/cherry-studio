import type { Element, Root } from 'hast'
import { describe, expect, it } from 'vitest'

import rehypeHeadingIds from '../../plugins/rehype-heading-ids'

const heading = (text: string): Element => ({
  type: 'element',
  tagName: 'h2',
  properties: {},
  children: [{ type: 'text', value: text }]
})

const idsOf = (headings: string[], slugs?: ReadonlyMap<string, readonly string[]>): string[] => {
  const root: Root = { type: 'root', children: headings.map(heading) }
  rehypeHeadingIds({ prefix: 'chunk', slugs })(root)
  return (root.children as Element[]).map((element) => String(element.properties.id))
}

describe('rehypeHeadingIds', () => {
  // A windowed preview hands over document-wide ids and leaves the rest to this slugger. Every
  // heading has to advance that slugger — assignments included — or the first unassigned heading
  // re-uses an id the document already gave out instead of numbering past it.
  it('numbers a heading without an assignment past the ids the document gave out', () => {
    expect(idsOf(['Title', 'Title'], new Map([['title', ['title']]]))).toEqual(['chunk--title', 'chunk--title-1'])
  })

  it('numbers its own headings when no assignments are handed over', () => {
    expect(idsOf(['Title', 'Title'])).toEqual(['chunk--title', 'chunk--title-1'])
  })
})
