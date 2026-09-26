import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../parseMarkdown'

describe('document image URLs', () => {
  it('keeps dangerous URL schemes out of image blocks when enabling file URLs', () => {
    for (const source of ['javascript:alert%281%29', 'vbscript:msgbox%281%29', 'data:text/html;base64,PHNjcmlwdD4=']) {
      const blocks = parseMarkdown(`![Image](${source})`)
      expect(blocks.some((block) => block.type === 'image')).toBe(false)
    }
  })
})
