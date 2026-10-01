import { describe, expect, it } from 'vitest'

import {
  stripKnownModelScratchpadBlocks,
  stripModelScratchpadBlocks,
  textStartsWithModelScratchpadTag
} from '../scratchpadText'

describe('scratchpadText', () => {
  it('detects scratchpad-shaped text by its opening wrapper tag', () => {
    expect(textStartsWithModelScratchpadTag('<thinking>plan</thinking>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('  <assessment>x</assessment>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('visible reply')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<div>markup</div>')).toBe(false)
  })

  it('strips arbitrary paired scratchpad blocks and unwraps summary payloads', () => {
    expect(
      stripModelScratchpadBlocks('<thinking>hidden</thinking><analysis>also hidden</analysis><summary>kept</summary>')
    ).toBe('kept')
  })

  it('removes thinking-only compaction output with no summary block', () => {
    expect(stripModelScratchpadBlocks('<thinking>long internal reasoning</thinking>')).toBe('')
  })

  it('preserves non-scratchpad markup when stripping compaction output', () => {
    expect(stripModelScratchpadBlocks('<thinking>hidden</thinking><div>visible</div>')).toBe('<div>visible</div>')
  })

  it('ignores summary tags nested inside scratchpad blocks', () => {
    expect(
      stripModelScratchpadBlocks(
        '<analysis><summary>decoy inside scratchpad</summary></analysis><summary>actual summary</summary>'
      )
    ).toBe('actual summary')
  })

  it('keeps trailing reply text when stripping known scratchpad wrappers', () => {
    expect(stripKnownModelScratchpadBlocks('<thinking>hidden</thinking>visible follow-up in the same block')).toBe(
      'visible follow-up in the same block'
    )
  })

  it('does not unwrap when an earlier non-nested summary tag precedes the compaction summary', () => {
    const input = `<analysis>
User asked how the HTML details element works; I explained collapsible blocks.
</analysis>

<details>
<summary>Click to expand the full example</summary>

The content that actually matters: 1. Task Overview  2. Current State  3. Next Steps.
</details>

<summary>
1. Task Overview: explain details/summary
2. Current State: example given
3. Next Steps: awaiting confirmation
</summary>`

    const result = stripModelScratchpadBlocks(input)

    expect(result).toContain('Task Overview: explain details/summary')
    expect(result).toContain('Click to expand the full example')
    expect(result).not.toBe('Click to expand the full example')
  })

  it('unwraps a whole summary block that quotes summary tags inside a fenced example', () => {
    const input = `<summary>
1. Task Overview: user wants the syntax for a reasoning tag
2. Example given:
\`\`\`xml
<analysis>model reasoning</analysis>
<summary>final answer</summary>
\`\`\`
3. Next Steps: none
</summary>`

    expect(stripModelScratchpadBlocks(input)).toBe(
      `1. Task Overview: user wants the syntax for a reasoning tag
2. Example given:
\`\`\`xml
<analysis>model reasoning</analysis>
<summary>final answer</summary>
\`\`\`
3. Next Steps: none`
    )
  })
})
