import { describe, expect, it } from 'vitest'

import {
  stripKnownModelScratchpadBlocks,
  stripModelScratchpadBlocks,
  textStartsWithModelScratchpadTag,
  textStartsWithNonScratchpadOpeningTag
} from '../scratchpadText'

describe('scratchpadText', () => {
  it('detects scratchpad-shaped text by its opening wrapper tag', () => {
    expect(textStartsWithModelScratchpadTag('<thinking>plan</thinking>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('  <assessment>x</assessment>')).toBe(true)
    expect(textStartsWithModelScratchpadTag('visible reply')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<div>markup</div>')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<thinking-note>ordinary markup</thinking-note>')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<thinking />')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<thinking mode="demo" />')).toBe(false)
    expect(textStartsWithModelScratchpadTag('<thinking data="path/foo">plan</thinking>')).toBe(true)
  })

  it('detects non-scratchpad opening tags without confusing scratchpad prefixes', () => {
    expect(textStartsWithNonScratchpadOpeningTag('<p>hello</p>')).toBe(true)
    expect(textStartsWithNonScratchpadOpeningTag('<thinking-note>x</thinking-note>')).toBe(true)
    expect(textStartsWithNonScratchpadOpeningTag('<thinking>hidden</thinking>')).toBe(false)
  })

  it('strips known scratchpad blocks and unwraps a whole-output summary wrapper', () => {
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

  it('does not unwrap when visible prose or markup precedes the compaction summary', () => {
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

  it('keeps a summary wrapper when introductory prose precedes it', () => {
    const input = 'Brief intro before the structured summary.\n\n<summary>1. Task: foo</summary>'
    const result = stripModelScratchpadBlocks(input)
    expect(result).toContain('Brief intro')
    expect(result).toContain('<summary>1. Task: foo</summary>')
  })

  it('preserves scratchpad-shaped literals inside tilde fences and longer backtick fences', () => {
    const tildeExample = `<summary>
Example:
~~~xml
<thinking>literal example</thinking>
~~~
</summary>`

    expect(stripModelScratchpadBlocks(tildeExample)).toContain('<thinking>literal example</thinking>')

    const fourTick = `<summary>
\`\`\`\`text
\`\`\`xml
<thinking>nested fence example</thinking>
\`\`\`
\`\`\`\`
</summary>`

    expect(stripModelScratchpadBlocks(fourTick)).toContain('<thinking>nested fence example</thinking>')
  })

  it('preserves analysis-note markup inside a summary wrapper', () => {
    const input = '<summary><analysis-note>keep</analysis-note><analysis>hidden</analysis>answer</summary>'
    expect(stripModelScratchpadBlocks(input)).toContain('<analysis-note>keep</analysis-note>')
    expect(stripModelScratchpadBlocks(input)).toContain('answer')
    expect(stripModelScratchpadBlocks(input)).not.toContain('hidden')
  })

  it('preserves attributed self-closing scratchpad tags while stripping paired wrappers', () => {
    const input = 'Example: <thinking mode="demo" /> should stay. <thinking>internal</thinking> Actual summary.'
    expect(stripKnownModelScratchpadBlocks(input)).toBe(
      'Example: <thinking mode="demo" /> should stay.  Actual summary.'
    )
  })

  it('preserves fenced scratchpad literals inside blockquote-indented fences', () => {
    const input = `<summary>
> ~~~xml
> <thinking>literal example</thinking>
> ~~~
</summary>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
  })

  it('preserves fenced scratchpad literals inside nested blockquote-indented fences', () => {
    const input = `<summary>
> > ~~~xml
> > <thinking>literal example</thinking>
> > ~~~
</summary>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
  })

  it('preserves scratchpad literals in an unclosed fence through end of input', () => {
    const input = `<summary>
\`\`\`xml
<thinking>literal example</thinking>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
  })

  it('strips slash-prefixed analysis content and unwraps the summary', () => {
    const input = '<analysis>/src/a.ts holds state</analysis><summary>Keep a.ts</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep a.ts')
  })

  it('preserves fenced scratchpad literals when the closing fence uses CRLF', () => {
    const input = `<summary>\r\n\`\`\`xml\r\n<thinking>literal example</thinking>\r\n\`\`\`\r\n</summary>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
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
