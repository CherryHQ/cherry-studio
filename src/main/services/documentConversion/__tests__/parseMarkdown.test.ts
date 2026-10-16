import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../parseMarkdown'

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

describe('document image URLs', () => {
  it('keeps dangerous URL schemes out of image blocks when enabling file URLs', () => {
    for (const source of ['javascript:alert%281%29', 'vbscript:msgbox%281%29', 'data:text/html;base64,PHNjcmlwdD4=']) {
      const blocks = parseMarkdown(`![Image](${source})`)
      expect(blocks.some((block) => block.type === 'image')).toBe(false)
    }
  })
})
