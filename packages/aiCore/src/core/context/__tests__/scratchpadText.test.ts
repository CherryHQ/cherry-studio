import { describe, expect, it } from 'vitest'

import { stripModelScratchpadBlocks, textStartsWithModelScratchpadTag } from '../scratchpadText'

describe('scratchpadText', () => {
  it('detects scratchpad-shaped text by its opening wrapper tag', () => {
    expect(textStartsWithModelScratchpadTag('<thinking>plan</thinking>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('  <assessment>x</assessment>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('visible reply')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<div>markup</div>')).toBe(false)
  })

  it('strips arbitrary paired scratchpad blocks and unwraps summary payloads', () => {
    expect(
      stripModelScratchpadBlocks(
        '<thinking>hidden</thinking><analysis>also hidden</analysis><summary>kept</summary>'
      )
    ).toBe('kept')
  })

  it('removes thinking-only compaction output with no summary block', () => {
    expect(stripModelScratchpadBlocks('<thinking>long internal reasoning</thinking>')).toBe('')
  })

  it('preserves non-scratchpad markup when stripping compaction output', () => {
    expect(stripModelScratchpadBlocks('<thinking>hidden</thinking><div>visible</div>')).toBe('<div>visible</div>')
  })
})
