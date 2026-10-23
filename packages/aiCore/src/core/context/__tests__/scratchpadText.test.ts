import { describe, expect, it } from 'vitest'

import {
  stripKnownModelScratchpadBlocks,
  stripKnownModelScratchpadBlocksPreservingCodeFences,
  stripTrailingToolProtocolClosingFragments,
  stripModelScratchpadBlocks,
  textHasUnclosedInlineCode,
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

  it('removes duplicate scratchpad closing tags left by compaction concatenation', () => {
    const leaked = '<thinking>Start time 01:44:15. Write content, get end time.  Write.</thinking></thinking>'
    expect(stripKnownModelScratchpadBlocks(leaked)).toBe('')
    expect(stripModelScratchpadBlocks(leaked)).toBe('')
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

  it('advances past an unmatched backtick run instead of reinterpreting its suffix', () => {
    // The unmatched `` must not yield a one-character advance whose leftover
    // backtick pairs with the next opener and masks the tags between them.
    const literal = 'Use `` then `<thinking>literal</thinking>` now.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(literal)).toBe(literal)
    expect(stripModelScratchpadBlocks(literal)).toBe(literal)
  })

  it('respects backslash escaping when locating opening delimiters', () => {
    const input = '<analysis>Use \\` to escape a delimiter.</analysis><summary>Keep `foo`</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep `foo`')
    // An escaped backslash does not escape the delimiter that follows it.
    const realOpener = '<analysis>hidden</analysis>Use \\\\`<thinking>literal</thinking>` intact'
    expect(stripModelScratchpadBlocks(realOpener)).toBe('Use \\\\`<thinking>literal</thinking>` intact')
  })

  it('keeps inline-code literal tags protected across a mismatched backtick run', () => {
    const literal = 'Use `two ticks `` and <thinking>literal</thinking>` now.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(literal)).toBe(literal)
    expect(stripModelScratchpadBlocks(literal)).toBe(literal)
  })

  it('respects Markdown-escaped scratchpad tags as literal content', () => {
    const literal = 'Use \\<thinking>literal\\</thinking> now.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(literal)).toBe(literal)
    expect(stripModelScratchpadBlocks(literal)).toBe(literal)
  })

  it('does not let an unmatched scratchpad backtick pair across the block boundary', () => {
    const input = '<analysis>I should use `foo.</analysis><summary>Run `ls`</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Run `ls`')
  })

  it('treats a backtick-wrapped closing tag as a literal mention, not the block boundary (inv_ed290cd7b29202da)', () => {
    // The analysis discusses the literal `</analysis>` tag: the real boundary
    // is the LATER unwrapped closer, and the internal tail must not survive.
    const input = '<analysis>Use `</analysis>` in code. SECRET_INTERNAL_TEXT</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe('<summary>Keep</summary>')
  })

  it('preserves scratchpad literals inside an indented Markdown code block (inv_29a1cf6c61a8326f)', () => {
    const input = 'Example:\n\n    <thinking>literal example</thinking>\n\nNext steps\u2026'
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
    expect(stripModelScratchpadBlocks(input)).toContain('Next steps')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toContain('<thinking>literal example</thinking>')
  })

  it('does not let indented content hide a scratchpad block boundary (inv_29a1cf6c61a8326f)', () => {
    const input = '<analysis>draft\n\n    </analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
  })
  it('tracks inline code across a line break before fence recognition', () => {
    const input = '<analysis>The docs use `a\n</thinking>~~~` as a closing marker.</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
  })

  it('preserves fenced scratchpad literals when a wrapper precedes the fence in the same block', () => {
    const mixed = '<thinking>internal</thinking>```xml\n<thinking>literal example</thinking>\n```'
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFences(mixed)
    expect(stripped).toContain('<thinking>literal example</thinking>')
    expect(stripped).not.toContain('internal')
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

  it('strips analysis with blockquote-indented fences and unwraps the summary', () => {
    const input = `<analysis>
> ~~~xml
> <thinking>internal</thinking>
> ~~~
</analysis><summary>Keep this</summary>`
    expect(stripModelScratchpadBlocks(input)).toBe('Keep this')
  })

  it('excludes inline-code openers when judging whether a fence sits inside a scratchpad wrapper', () => {
    // cherry-pr-review inv_fedee4736993b558: the inline-code `<thinking>`
    // opener is a literal, so the completed fence below it is ordinary code
    // content and both example elements survive in full.
    const text = 'Use `<thinking>` blocks:\n```xml\n<thinking>one</thinking>\n<thinking>two</thinking>\n```'
    expect(stripModelScratchpadBlocks(text)).toBe(text)
  })

  it('preserves scratchpad-shaped literals inside inline code spans', () => {
    const input = 'Use the literal `<thinking>foo</thinking>` tag in your reply.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })

  it('preserves fenced scratchpad literals inside list-item fences', () => {
    const input = `<summary>
- \`\`\`xml
  <thinking>literal example</thinking>
  \`\`\`
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

  it('strips analysis when inline code mentions tilde fence delimiters', () => {
    const input = '<analysis>The user supplied `~~~` delimiters.</analysis><summary>Keep this</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep this')
  })

  it('preserves scratchpad literals in a two-space-indented XML fence', () => {
    const input = `<summary>
  \`\`\`xml
  <thinking>literal</thinking>
  \`\`\`
</summary>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal</thinking>')
  })

  it('strips slash-prefixed analysis when inline code mentions a closing-tag and tilde run', () => {
    const input = '<analysis>The docs use `</div>~~~` as a closing marker.</analysis><summary>Keep this</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep this')
  })

  it('preserves scratchpad literals inside ordered-list fences using a parenthesis marker', () => {
    const input = `<summary>
1) \`\`\`xml
   <thinking>literal</thinking>
   \`\`\`
</summary>`
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal</thinking>')
    expect(stripModelScratchpadBlocks(input)).not.toMatch(/^<summary>/)
  })

  it('finishes opening-tag recognition quickly on long self-closing attribute lists', () => {
    const tag = `<thinking${Array.from({ length: 20 }, (_, i) => ` a${i}=""`).join('')} />`
    const started = performance.now()
    expect(textStartsWithModelScratchpadTag(tag)).toBe(false)
    expect(stripModelScratchpadBlocks(tag)).toBe(tag)
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('strips trailing tool-protocol closing fragments after visible prose', () => {
    const input = '继续补「以前的信息」。\n\n</parameter>\n</tool_calls>'
    expect(stripTrailingToolProtocolClosingFragments(input)).toBe('继续补「以前的信息」。')
  })

  it('strips trailing DSML-style closing fragments', () => {
    const input = 'Console encoding issue…\n</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>'
    expect(stripTrailingToolProtocolClosingFragments(input)).toBe('Console encoding issue…')
  })

  it('preserves closing tags inside inline code when stripping trailing tool-protocol fragments', () => {
    const input = 'Use `</parameter>` in examples.\n\n</tool_calls>'
    expect(stripTrailingToolProtocolClosingFragments(input)).toBe('Use `</parameter>` in examples.')
  })

  it('preserves literal XML inside a fence when a later line only resembles a closing delimiter', () => {
    const input = `~~~xml
~~~not-a-closing-fence
<thinking>literal XML</thinking>
~~~`
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
    expect(stripModelScratchpadBlocks(`<summary>${input}</summary>`)).toContain('<thinking>literal XML</thinking>')
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

describe('unfinished fences inside scratchpad blocks', () => {
  it('strips analysis interrupted by an unfinished fence and unwraps the summary', () => {
    const input = '<analysis>I considered:\n```\n</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
  })
})

describe('round-3 scanner regressions', () => {
  it('bounds a fence opened inside a scratchpad block at the block close even when a later fence matches (inv_e5404aa552bba2ea)', () => {
    const input =
      '<analysis>notes\n```ts\ncode without close\n</analysis>\n<summary>\n```ts\nshown\n```\n</summary>\nactual answer'
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFences(input)
    expect(stripped).not.toContain('notes')
    expect(stripped).not.toContain('code without close')
    expect(stripped).toContain('shown')
    expect(stripped).toContain('actual answer')
  })

  it('strips nested same-tag scratchpad blocks through the matching outer close (inv_66625e6e9e1af1a5)', () => {
    const input = '<analysis>outer <analysis>inner</analysis> still internal</analysis>visible answer'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe('visible answer')
  })

  it('ignores escaped backticks when scanning for unclosed inline code (inv_c15500c90c596f07)', () => {
    expect(textHasUnclosedInlineCode('an escaped \\` backtick alone')).toBe(false)
    expect(textHasUnclosedInlineCode('an unclosed `span here')).toBe(true)
  })

  it('treats a closer inside a completed fence as literal, not the block boundary (inv_bbe597af484323aa)', () => {
    const text = '<analysis>Example:\n```xml\n<analysis>foo</analysis>\n```\nSECRET</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(text)).toBe('Keep')
  })
})
