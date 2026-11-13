import type { Element, Root } from 'hast'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { rehypeTextDirection } from '../rehypeTextDirection'

function transform(tree: Root): Root {
  return unified().use(rehypeTextDirection).runSync(tree)
}

function findAll(node: Root | Element, tagName: string): Element[] {
  const found: Element[] = []
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tagName === tagName) found.push(child)
    found.push(...findAll(child, tagName))
  }
  return found
}

function paragraph(text: string): Root {
  return {
    type: 'root',
    children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: text }] }]
  }
}

describe('rehypeTextDirection', () => {
  it('sets rtl on Arabic-dominant paragraphs starting with a Latin word', () => {
    const [p] = findAll(transform(paragraph('React هي مكتبة لبناء واجهات المستخدم')), 'p')
    expect(p?.properties?.dir).toBe('rtl')
  })

  it('sets ltr on English-dominant paragraphs', () => {
    const [p] = findAll(transform(paragraph('The Arabic label is مرحبا, and this paragraph is English.')), 'p')
    expect(p?.properties?.dir).toBe('ltr')
  })

  it('keeps an author-provided dir and leaves code-only blocks alone', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: { dir: 'ltr' },
          children: [{ type: 'text', value: 'هذا نص عربي كامل' }]
        },
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: 'const x = 1' }] }
          ]
        },
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: 'React' }] }]
        }
      ]
    } as Root

    const [first, second] = findAll(transform(tree), 'p')
    expect(first?.properties?.dir).toBe('ltr')
    expect(second?.properties?.dir).toBeUndefined()
  })

  it('excludes link text from the vote', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'هذا شرح عربي للمكتبة ' },
            {
              type: 'element',
              tagName: 'a',
              properties: { href: 'https://example.com/docs' },
              children: [{ type: 'text', value: 'React documentation page here' }]
            }
          ]
        }
      ]
    } as Root

    const [p] = findAll(transform(tree), 'p')
    expect(p?.properties?.dir).toBe('rtl')
  })
})
