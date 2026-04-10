import { describe, expect, it } from 'vitest'

import {
  appendCompareMetaToMarkdown,
  buildCompareBlockMarkerLine,
  extractCompareMetaFromMarkdown,
  parseCompareBlockMarkerLine,
  replaceCompareMarkersForHtml
} from '../helpers/compareBlockCodec'

describe('compareBlockCodec', () => {
  it('roundtrips meta tag (utf-8 safe)', () => {
    const body = '# 标题\n\n正文\n'
    const meta = {
      v: 1 as const,
      blocks: {
        cb_1: { content: '对照内容 ✅\n- 列表' }
      }
    }

    const full = appendCompareMetaToMarkdown(body, meta)
    const extracted = extractCompareMetaFromMarkdown(full)

    expect(extracted.cleanMarkdown).toBe(body.trimEnd())
    expect(extracted.meta).toEqual(meta)
  })

  it('does not strip invalid meta tag to avoid data loss', () => {
    const body = '正文'
    const full = `${body}\n\n<cs-compare-meta data-v="1" data-json="not-base64"></cs-compare-meta>\n`
    const extracted = extractCompareMetaFromMarkdown(full)

    expect(extracted.meta).toBeNull()
    expect(extracted.cleanMarkdown).toBe(full)
  })

  it('parses and builds compare marker line', () => {
    const line = '--- <!-- cs-compare-block:cb_abc collapsed=0 -->'
    const parsed = parseCompareBlockMarkerLine(line)
    expect(parsed).toEqual({ id: 'cb_abc', collapsed: false })

    const rebuilt = buildCompareBlockMarkerLine({ id: 'cb_abc', collapsed: false })
    expect(rebuilt).toBe(line)
  })

  it('replaces marker lines for html', () => {
    const md = ['a', '--- <!-- cs-compare-block:cb_x collapsed=1 -->', 'b'].join('\n')
    const out = replaceCompareMarkersForHtml(md)
    expect(out).toContain('<cs-compare-block')
    expect(out).toContain('data-id="cb_x"')
    expect(out).toContain('data-collapsed="1"')
  })
})
