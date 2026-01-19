import { describe, expect, it } from 'vitest'

import { buildCaretBlock, encodeBase64Utf8, replaceCaretBlocksForHtml } from '../helpers/compareBlockCodec'

describe('compareBlockCodec', () => {
  it('builds caret block', () => {
    const content = '第一行\n第二行'
    expect(buildCaretBlock(content)).toBe(`^^\n${content}\n^^`)
  })

  it('replaces caret blocks for html', () => {
    const content = 'line1\nline2'
    const md = ['a', '^^', 'line1', 'line2', '^^', 'b'].join('\n')
    const out = replaceCaretBlocksForHtml(md)
    const encoded = encodeBase64Utf8(content)

    expect(out).toContain('<cs-compare-block')
    expect(out).toContain(`data-content="${encoded}"`)
    expect(out).toContain('data-collapsed="1"')
  })

  it('keeps caret delimiter when closing is missing', () => {
    const md = ['^^', 'line1', 'line2'].join('\n')
    const out = replaceCaretBlocksForHtml(md)
    expect(out).toBe(md)
  })
})
