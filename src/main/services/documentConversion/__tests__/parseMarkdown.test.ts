import { JSDOM } from 'jsdom'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { DocumentConversionError } from '../DocumentConversionError'
import { convertDocx } from '../docx'
import { parseMarkdown } from '../parseMarkdown'
import { documentToHtml, documentToMarkdown } from '../serializeDocument'

describe('PDF-generated inline HTML', () => {
  it('turns anydoc underline markup into a plain underlined heading', () => {
    const [heading] = parseMarkdown('# <u>Card source 15659</u>', true, { interpretSafeHtml: true })
    expect(heading).toMatchObject({
      type: 'heading',
      text: 'Card source 15659',
      runs: [{ text: 'Card source 15659', underline: true }]
    })
    expect(JSON.stringify(heading)).not.toContain('<u>')
  })

  it('keeps literal angle brackets in user Markdown', () => {
    const [heading] = parseMarkdown('# <u>Card source 15659</u>')
    expect(heading).toMatchObject({ type: 'heading', text: '<u>Card source 15659</u>' })
    const [prose] = parseMarkdown('Compare a < b and keep <not-a-tag> prose.')
    expect(prose).toMatchObject({ type: 'text', text: 'Compare a < b and keep <not-a-tag> prose.' })
  })
})

describe('nested container tables', () => {
  const rows = [
    ['A', 'B'],
    ['1', '2']
  ]

  it('accepts a table under every quote and list nesting order', () => {
    const sources = [
      '- > | A | B |\n  > | --- | --- |\n  > | 1 | 2 |',
      '> - | A | B |\n>   | --- | --- |\n>   | 1 | 2 |',
      '> - > | A | B |\n>   > | --- | --- |\n>   > | 1 | 2 |',
      '1. > | A | B |\n   > | --- | --- |\n   > | 1 | 2 |',
      '- - | A | B |\n    | --- | --- |\n    | 1 | 2 |',
      '> > 1. | A | B |\n> >    | --- | --- |\n> >    | 1 | 2 |'
    ]
    for (const markdown of sources) {
      expect(parseMarkdown(markdown).find((block) => block.type === 'table')).toMatchObject({ type: 'table', rows })
    }
  })

  it('keeps escaped pipes and pipes inside code spans in the cell that owns them', () => {
    const [table] = parseMarkdown('| A \\| B | `x\\|y` |\n| --- | --- |\n| 1 | 2 |')
    expect(table).toMatchObject({
      type: 'table',
      rows: [
        ['A | B', 'x|y'],
        ['1', '2']
      ]
    })
  })

  it('rejects a nested table row with an extra or missing cell', () => {
    const extra = '- > | A | B |\n  > | --- | --- |\n  > | 1 | 2 | 3 |'
    const missing = '> - | A | B |\n>   | --- | --- |\n>   | 1 |'
    for (const markdown of [
      extra,
      missing,
      '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',
      '| A | B |\n| --- | --- |\n| 1 |'
    ]) {
      expect(() => parseMarkdown(markdown)).toThrow(DocumentConversionError)
      try {
        parseMarkdown(markdown)
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_TABLE' })
      }
    }
  })
})

describe('leading nested lists', () => {
  const shape = (markdown: string) =>
    parseMarkdown(markdown).map((block) => ({
      type: block.type,
      text: 'text' in block ? block.text : undefined,
      bullet: 'bullet' in block ? block.bullet : undefined,
      orderedNumber: 'orderedNumber' in block ? block.orderedNumber : undefined,
      listDepth: 'listDepth' in block ? block.listDepth : undefined
    }))

  const roundTrip = (markdown: string) => documentToMarkdown(parseMarkdown(markdown), (source) => source)

  const nestedItem = (markdown: string) => {
    const body = new JSDOM(documentToHtml(parseMarkdown(markdown), (source) => source, 'Lists')).window.document.body
    const item = body.querySelector('li')
    return {
      child: item?.querySelector(':scope > ul > li, :scope > ol > li')?.textContent ?? '',
      text: item?.textContent ?? '',
      siblings: body.querySelectorAll('body > ul > li, body > ol > li').length
    }
  }

  it('emits the parent marker before a nested list and keeps later text as a continuation', async () => {
    const markdown = '- - Child\n\n  More\n- Next'
    expect(shape(markdown)).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])

    const html = documentToHtml(parseMarkdown(markdown), (source) => source, 'Lists')
    const body = new JSDOM(html).window.document.body
    const items = [...body.querySelectorAll('body > ul > li')]
    expect(items).toHaveLength(2)
    expect(items[0]?.querySelector(':scope > ul > li')?.textContent).toContain('Child')
    expect(items[0]?.textContent).toContain('More')
    expect(items[1]?.textContent).toContain('Next')
    expect(items[1]?.querySelector('ul')).toBeNull()

    const word = await JSZip.loadAsync(await convertDocx(parseMarkdown(markdown), new Map(), 'Lists'))
    const xml = await word.file('word/document.xml')!.async('string')
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0])
    const listed = paragraphs.flatMap((paragraph) => {
      const level = paragraph.match(/<w:ilvl w:val="(\d+)"/)?.[1]
      if (level === undefined) return []
      const text = [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join('')
      return [{ level: Number(level), text }]
    })
    expect(listed.map((item) => item.level)).toEqual([0, 1, 0])
    expect(listed.map((item) => item.text)).toEqual(['', 'Child', 'Next'])
    expect(xml).toContain('More')

    const round = roundTrip(markdown)
    expect(round.startsWith('- \n  - Child\n')).toBe(true)
    expect(round).not.toContain('- \n\n')
    expect(shape(round)).toEqual(shape(markdown))
    expect(nestedItem(round)).toEqual({ child: 'Child', text: 'ChildMore', siblings: 2 })
  })

  it('keeps ordered starts, mixed markers, deeper parents, and marker-free continuations', () => {
    expect(shape('3. 4. Child\n\n   More\n4. Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 4, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 4, listDepth: 1 }
    ])
    expect(shape('1. - Child\n\n   More\n2. Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: 1, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 2, listDepth: 1 }
    ])
    expect(shape('- 1. Child\n\n  More\n- Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Child', bullet: 2, orderedNumber: 1, listDepth: 2 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(shape('- - - Deep\n\n  Later\n- Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: '', bullet: 2, orderedNumber: undefined, listDepth: 2 },
      { type: 'text', text: 'Deep', bullet: 3, orderedNumber: undefined, listDepth: 3 },
      { type: 'text', text: 'Later', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(shape('- Parent\n\n  More\n- Next')).toEqual([
      { type: 'text', text: 'Parent', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'More', bullet: undefined, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    for (const markdown of [
      '3. 4. Child\n\n   More\n4. Next',
      '1. - Child\n\n   More\n2. Next',
      '- 1. Child\n\n  More\n- Next',
      '- - - Deep\n\n  Later\n- Next'
    ]) {
      const round = roundTrip(markdown)
      expect(shape(round)).toEqual(shape(markdown))
      const direct = nestedItem(markdown)
      expect(nestedItem(round)).toEqual(direct)
      expect(direct.child.length).toBeGreaterThan(0)
      expect(direct.text).toMatch(/More|Later/)
    }
    const continued = roundTrip('- Parent\n\n  More\n- Next')
    expect(continued).toContain('- Parent\n\n  More\n')
    expect(continued).not.toMatch(/\n\s*- More/)
    expect(shape(continued)).toEqual(shape('- Parent\n\n  More\n- Next'))
  })

  it('keeps consecutive and trailing empty ordered and bullet items', async () => {
    expect(shape('3.\n4. Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 4, listDepth: 1 }
    ])
    expect(shape('3.\n4.\n5. Next\n6.')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: 3, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: 4, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: 5, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: 6, listDepth: 1 }
    ])
    expect(shape('-\n-\n- Next')).toEqual([
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])
    expect(shape('- Next\n-\n-')).toEqual([
      { type: 'text', text: 'Next', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 },
      { type: 'text', text: '', bullet: 1, orderedNumber: undefined, listDepth: 1 }
    ])

    const word = await JSZip.loadAsync(await convertDocx(parseMarkdown('3.\n4. Next'), new Map(), 'Lists'))
    const xml = await word.file('word/document.xml')!.async('string')
    const listed = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].flatMap((match) => {
      const paragraph = match[0]
      if (!paragraph.includes('<w:ilvl ')) return []
      return [[...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((part) => part[1]).join('')]
    })
    expect(listed).toEqual(['', 'Next'])
    expect(roundTrip('-\n-\n- Next').match(/^- $/gm)).toHaveLength(2)
  })

  it('still opens a leading table, image, code block, or heading as the parent item', () => {
    const table = '- | A | B |\n  | --- | --- |\n  | 1 | 2 |\n  - Child'
    expect(shape(table).filter((block) => block.type === 'text' && block.text === '')).toEqual([])
    expect(shape(table).map((block) => [block.type, block.bullet, block.text])).toEqual([
      ['table', 1, undefined],
      ['text', 2, 'Child']
    ])
    expect(
      shape('- ![logo](file:///tmp/logo.png)\n  - Child').map((block) => [block.type, block.bullet, block.text])
    ).toEqual([
      ['image', 1, 'logo'],
      ['text', 2, 'Child']
    ])
    expect(shape('- ```\n  code\n  ```\n  - Child').map((block) => [block.type, block.bullet, block.text])).toEqual([
      ['code', 1, 'code\n'],
      ['text', 2, 'Child']
    ])
    expect(shape('- # Title\n  - Child').map((block) => [block.type, block.bullet, block.text])).toEqual([
      ['heading', 1, 'Title'],
      ['text', 2, 'Child']
    ])
  })
})

describe('document image URLs', () => {
  it('keeps dangerous URL schemes out of image blocks when enabling file URLs', () => {
    for (const source of ['javascript:alert%281%29', 'vbscript:msgbox%281%29', 'data:text/html;base64,PHNjcmlwdD4=']) {
      const blocks = parseMarkdown(`![Image](${source})`)
      expect(blocks.some((block) => block.type === 'image')).toBe(false)
    }
  })
})
