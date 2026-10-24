// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { DocumentBlock, DocumentStyle, DocumentTextRun } from '../documentModel'
import { parseMarkdown } from '../parseMarkdown'
import { documentToHtml, documentToMarkdown } from '../serializeDocument'

function textItem(
  text: string,
  bullet: number,
  orderedNumber?: number,
  extras?: { runs?: DocumentTextRun[]; style?: DocumentStyle }
): DocumentBlock {
  return {
    type: 'text',
    text,
    bullet,
    ...(orderedNumber !== undefined ? { orderedNumber } : {}),
    ...extras
  }
}

function listFields(blocks: DocumentBlock[]) {
  return blocks.map((block) => {
    if (block.type !== 'text') throw new Error(`expected a text block, received ${block.type}`)
    return { text: block.text, bullet: block.bullet, orderedNumber: block.orderedNumber }
  })
}

interface HtmlListItem {
  text: string
  value: string | null
  children: HtmlList[]
}

interface HtmlList {
  tag: string
  start: string | null
  items: HtmlListItem[]
}

function htmlLists(parent: ParentNode): HtmlList[] {
  return [...parent.children]
    .filter((element) => element.tagName === 'OL' || element.tagName === 'UL')
    .map((list) => ({
      tag: list.tagName,
      start: list.getAttribute('start'),
      items: [...list.children]
        .filter((element) => element.tagName === 'LI')
        .map((item) => ({
          text: [...item.childNodes]
            .filter((node) => node.nodeName !== 'OL' && node.nodeName !== 'UL')
            .map((node) => node.textContent ?? '')
            .join('')
            .trim(),
          value: item.getAttribute('value'),
          children: htmlLists(item)
        }))
    }))
}

function bodyLists(blocks: DocumentBlock[]): HtmlList[] {
  const html = documentToHtml(blocks, (source) => source, 'Lists')
  return htmlLists(new DOMParser().parseFromString(html, 'text/html').body)
}

describe('document list serialization', () => {
  it('nests a child ordered list inside its parent item', () => {
    const blocks = [
      textItem('Parent', 1, 1, { style: { indent: 12 } }),
      textItem('Child', 2, 1),
      textItem('Next', 1, 2)
    ]

    expect(bodyLists(blocks)).toEqual([
      {
        tag: 'OL',
        start: '1',
        items: [
          {
            text: 'Parent',
            value: '1',
            children: [{ tag: 'OL', start: '1', items: [{ text: 'Child', value: '1', children: [] }] }]
          },
          { text: 'Next', value: '2', children: [] }
        ]
      }
    ])

    const html = documentToHtml(blocks, (source) => source, 'Lists')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('li')?.getAttribute('style')).toContain(
      'margin-left:12pt'
    )
    expect(listFields(parseMarkdown(documentToMarkdown(blocks, (source) => source)))).toEqual([
      { text: 'Parent', bullet: 1, orderedNumber: 1 },
      { text: 'Child', bullet: 2, orderedNumber: 1 },
      { text: 'Next', bullet: 1, orderedNumber: 2 }
    ])
  })

  it('keeps mixed list types, explicit item numbers, and separate lists around prose', () => {
    expect(
      bodyLists([textItem('Parent', 1, 1), textItem('Child', 2), textItem('Grandchild', 3, 4), textItem('Next', 1, 7)])
    ).toEqual([
      {
        tag: 'OL',
        start: '1',
        items: [
          {
            text: 'Parent',
            value: '1',
            children: [
              {
                tag: 'UL',
                start: null,
                items: [
                  {
                    text: 'Child',
                    value: null,
                    children: [{ tag: 'OL', start: '4', items: [{ text: 'Grandchild', value: '4', children: [] }] }]
                  }
                ]
              }
            ]
          },
          { text: 'Next', value: '7', children: [] }
        ]
      }
    ])

    const interrupted = [
      textItem('First', 1, 3),
      { type: 'text' as const, text: 'Between <tags>' },
      textItem('Second', 1)
    ]
    const html = documentToHtml(interrupted, (source) => source, 'Lists')
    const body = new DOMParser().parseFromString(html, 'text/html').body
    expect([...body.children].map((element) => element.tagName)).toEqual(['OL', 'P', 'UL'])
    expect(htmlLists(body)).toEqual([
      { tag: 'OL', start: '3', items: [{ text: 'First', value: '3', children: [] }] },
      { tag: 'UL', start: null, items: [{ text: 'Second', value: null, children: [] }] }
    ])
    expect(html).toContain('Between &lt;tags&gt;')
    expect(body.querySelector('p')?.textContent).toBe('Between <tags>')
  })

  it('preserves ordered, mixed, and multi-digit hierarchy when Markdown is parsed back', () => {
    const markdown = documentToMarkdown(
      [
        textItem('Nine', 1, 9),
        textItem('Nine child', 2),
        textItem('Ten', 1, 10),
        textItem('Ten child', 2, 12),
        textItem('Leaf', 3),
        textItem('Eleven', 1, 11)
      ],
      (source) => source
    )

    expect(listFields(parseMarkdown(markdown))).toEqual([
      { text: 'Nine', bullet: 1, orderedNumber: 9 },
      { text: 'Nine child', bullet: 2, orderedNumber: undefined },
      { text: 'Ten', bullet: 1, orderedNumber: 10 },
      { text: 'Ten child', bullet: 2, orderedNumber: 12 },
      { text: 'Leaf', bullet: 3, orderedNumber: undefined },
      { text: 'Eleven', bullet: 1, orderedNumber: 11 }
    ])
  })

  it('keeps literal text and emphasis inside nested list items', () => {
    const blocks = [
      textItem('Parent <b> &', 1, 1, { runs: [{ text: 'Parent <b> &', bold: true }] }),
      textItem('10. Child ~~x~~', 2, 10, { runs: [{ text: '10. Child ~~x~~', italic: true }] })
    ]

    expect(
      listFields(
        parseMarkdown(
          documentToMarkdown(blocks, (source) => source),
          true,
          { interpretSafeHtml: true }
        )
      )
    ).toEqual([
      { text: 'Parent <b> &', bullet: 1, orderedNumber: 1 },
      { text: '10. Child ~~x~~', bullet: 2, orderedNumber: 10 }
    ])
    expect(
      parseMarkdown(
        documentToMarkdown(blocks, (source) => source),
        true,
        { interpretSafeHtml: true }
      )
    ).toMatchObject([
      { runs: [{ text: 'Parent <b> &', bold: true }] },
      { runs: [{ text: '10. Child ~~x~~', italic: true }] }
    ])

    const html = documentToHtml(blocks, (source) => source, 'Lists')
    expect(html).toContain('Parent &lt;b&gt; &amp;')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('10. Child ~~x~~')
    expect(html).toContain('font-style:italic')
    expect(bodyLists(blocks)[0]?.items[0]?.children[0]?.items[0]?.text).toBe('10. Child ~~x~~')
  })
})
