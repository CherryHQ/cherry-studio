import { describe, expect, it } from 'vitest'

import {
  stripKnownModelScratchpadBlocks,
  stripKnownModelScratchpadBlocksPreservingCodeFences,
  stripTrailingToolProtocolClosingFragments,
  stripModelScratchpadBlocks,
  textHasUnclosedInlineCode,
  textHasUnclosedCodeFence,
  shouldDeferScratchpadStripping,
  textStartsWithModelScratchpadTag,
  textStartsWithNonScratchpadOpeningTag
} from '../scratchpadText'

describe('scratchpadText', () => {
  it.each([
    '12. Heading\n    =======\n        <thinking>literal</thinking>\n\nDone.',
    '12. Example:\n    ```xml\n    <thinking>literal</thinking>'
  ])('preserves literal code at a wide list content column', (input) => {
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
  })
  it('ends inner unfinished fences at outer scratchpad boundaries (inv_927de58150a57af8)', () => {
    expect(
      stripModelScratchpadBlocks(
        '<analysis>Use <thinking> for reasoning.\n```text\nSECRET\n</analysis>\n<summary>Public</summary>'
      )
    ).toBe('Public')
  })

  it('ignores opaque closers while bounding unfinished scratchpad fences (inv_3fd1bf2ede509a71)', () => {
    const input = '<analysis>Private\n```xml\n<!-- </analysis> -->\nSECRET\n</analysis>\n<summary>Public</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Public')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
  })

  it('tracks list indentation inside quotes (inv_43213537eba0ef5c)', () => {
    const input = '> - Notes:\n>\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
  })
  it('excludes opaque backticks from scratchpad boundary spans (inv_b7c24c0ee551e890)', () => {
    const input = '<analysis>Use <!-- ` --> SECRET</analysis><summary>Use `</analysis>` literally</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Use `</analysis>` literally')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(
      '<summary>Use `</analysis>` literally</summary>'
    )
  })

  it('ignores CDATA backticks during inline matching (inv_51b0729e38ad3e6f)', () => {
    expect(
      stripModelScratchpadBlocks('<summary>Keep<![CDATA[`]]><analysis>SECRET</analysis> public `x`</summary>')
    ).not.toContain('SECRET')
  })

  it('ignores CDATA-contained closing tags (inv_05530378ffef12c7)', () => {
    expect(
      stripModelScratchpadBlocks('<analysis>Use <![CDATA[</analysis>]]> SECRET</analysis><summary>Public</summary>')
    ).toBe('Public')
  })
  it('keeps comment-contained openers from capturing fences (inv_07c84e0e19a99d27)', () => {
    const text =
      '<summary><!-- <thinking> -->\n\n```xml\n</thinking>\n<assessment>literal</assessment>\n```\n</summary>'
    expect(stripModelScratchpadBlocks(text)).toContain('```xml\n</thinking>\n<assessment>literal</assessment>\n```')
  })

  it('tracks nested list continuation padding (inv_b981b2250f323698)', () => {
    expect(
      stripModelScratchpadBlocks(
        '- One\n  - Two\n    - Three\n\n        <analysis>SECRET</analysis>\n\n<summary>Public</summary>'
      )
    ).not.toContain('SECRET')
  })

  it('ignores comment-contained scratchpad closing tags (inv_a7e5f0f1985e0e7c)', () => {
    expect(
      stripModelScratchpadBlocks('<analysis>Use <!-- </analysis> --> SECRET</analysis><summary>Keep</summary>')
    ).toBe('Keep')
  })
  it.each(['tool_result-example', 'invoke-custom', 'parameter-note'])(
    'preserves unrelated closing element %s (inv_cf970285925ef5bb)',
    (tag) => {
      const text = 'The custom tag closes with </' + tag + '>'
      expect(stripTrailingToolProtocolClosingFragments(text)).toBe(text)
    }
  )

  it.each(['-   First', '1.  First', '-\tFirst'])(
    'uses actual list padding for continuation: %s (inv_72d005c389d50445)',
    (first) => {
      expect(
        stripModelScratchpadBlocks(first + '\n\n      <analysis>SECRET</analysis>\n\n<summary>Public</summary>')
      ).not.toContain('SECRET')
    }
  )

  it('keeps HTML comment ticks opaque (inv_1f37db24d5849b59)', () => {
    expect(
      stripModelScratchpadBlocks('<summary>Keep<!-- ` --> <analysis>SECRET</analysis> public `x`</summary>')
    ).not.toContain('SECRET')
  })

  it.each(['<!DOCTYPE html>', '<?pi data?>', '<![CDATA[data]]>'])(
    'bounds inline spans at HTML special blocks: %s (inv_61ef437e3bc90d4c)',
    (block) => {
      expect(
        stripModelScratchpadBlocks('Unmatched ` marker.\n' + block + '\n<analysis>SECRET</analysis>\nLater `example`.')
      ).not.toContain('SECRET')
    }
  )

  it('resets paragraph identity when inherited list quote ends (inv_abe5b2ba1a27f3e4)', () => {
    const input = '- First\n  > First\n>     <thinking>literal</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })
  it('bounds inline spans at details HTML blocks (inv_53675383c8c9885e)', () => {
    expect(
      stripModelScratchpadBlocks(
        'Unmatched ` marker.\n<details>\n<analysis>SECRET</analysis>\n</details>\nLater `example`.'
      )
    ).not.toContain('SECRET')
  })
  it('uses complete summary after unmatched leading analysis (inv_b290db1b201353da)', () => {
    expect(stripModelScratchpadBlocks('<analysis>private reasoning\n<summary>public</summary>')).toBe('public')
  })

  it('preserves tab-separated list code (inv_b29097d457dd8757)', () => {
    const input = '-\t    <thinking>literal</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })
  it('bounds spans at HTML block tags (inv_bc025925963e8a39)', () => {
    const input = 'Unmatched ` marker.\n<div>\n<analysis>SECRET</analysis>\n</div>\nLater `example`.'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
  })
  it('ignores literal ticks inside completed tilde fences when deferring (inv_71aadfb8c04c8eb0)', () => {
    expect(shouldDeferScratchpadStripping('~~~text\nA literal ` marker\n~~~\nAnswer')).toBe(false)
  })

  it('consumes inherited list indentation once before a quote (inv_eae0f87bf5ff88fe)', () => {
    const input = '- First\n  >     <thinking>literal</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
  })

  it('counts inherited list indentation before code indentation (inv_c5db9091dfd965bf)', () => {
    expect(
      stripModelScratchpadBlocks('- Notes:\n\n    <analysis>SECRET</analysis>\n\n<summary>Public</summary>')
    ).not.toContain('SECRET')
    expect(stripModelScratchpadBlocks('- Notes:\n\n      <thinking>literal</thinking>')).toContain(
      '<thinking>literal</thinking>'
    )
  })
  it.each(['~~~text\nliteral\n~~~', '```text\nliteral\n```', '<!-- comment -->'])(
    'bounds inline spans at intervening blocks: %s (inv_e528d8c6ccfcad34)',
    (block) => {
      const input = 'Unmatched ` marker.\n' + block + '\n<analysis>SECRET</analysis>\nLater `example`'
      expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    }
  )

  it('keeps sibling list indented code (inv_ea30cb629bf6555d)', () => {
    const input = '- First\n-     <thinking>literal</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
  })
  it('keeps enclosing HTML attributes opaque despite tag-shaped values (inv_1fff6722f23de3fd)', () => {
    const input = '<summary>Keep <span title="<thinking>`"></span><analysis>SECRET</analysis>Text `code`</summary>'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
  })
  it('rejects backticks in fence info strings (inv_ca7b25d8a9179d30)', () => {
    const input = '<summary>Keep\n```bad`info\n<analysis>SECRET</analysis>\n</summary>'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(textHasUnclosedCodeFence(input)).toBe(false)
    expect(textHasUnclosedCodeFence('```valid\ncode')).toBe(true)
    expect(stripModelScratchpadBlocks('~~~bad`info\n<analysis>literal</analysis>\n~~~')).toContain(
      '<analysis>literal</analysis>'
    )
  })

  it('does not open Markdown spans inside HTML attributes (inv_5e10fb47f657550e)', () => {
    const input = '<summary>Keep <span title="`"></span><analysis>SECRET_INTERNAL</analysis>Text `code`</summary>'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET_INTERNAL')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET_INTERNAL')
  })

  it('keeps quote fence content without marker padding (inv_5ef957f445b2ad1d)', () => {
    const input = '<summary>\n> ```xml\n><thinking>literal example</thinking>\n> ```\n</summary>'
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
  })

  it.each(['\r', '\n', '\r\n'])(
    'does not pair inline spans across new blockquotes: %j (inv_087f3297499105f5)',
    (eol) => {
      const input = '`one\n> <analysis>SECRET</analysis> two`'.split('\n').join(eol)
      expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
    }
  )

  it.each(['\r', '\n', '\r\n'])('resets paragraph state for new quote containers: %j (inv_ea1efe67418ecef8)', (eol) => {
    for (const source of [
      'Here is a quote:\n>     <thinking>literal</thinking>',
      '> outer paragraph\n> >     <thinking>literal</thinking>'
    ]) {
      const input = source.split('\n').join(eol)
      expect(stripModelScratchpadBlocks(input)).toBe(input)
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
    }
  })

  it.each(['\r', '\n', '\r\n'])(
    'preserves a closing fence separator before indented code: %j (inv_03d53afef974b909)',
    (eol) => {
      const input = '```text\nfirst\n```\n    <thinking>literal</thinking>'.split('\n').join(eol)
      expect(stripModelScratchpadBlocks(input)).toBe(input)
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
    }
  )

  it.each(['\r', '\n', '\r\n'])('preserves original line endings while masking literal blocks: %j', (eol) => {
    for (const input of [
      '```xml\n<thinking>literal</thinking>\n```',
      'Example:\n\n    <thinking>literal</thinking>\n    next'
    ]) {
      const text = input.split('\n').join(eol)
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(text)).toBe(text)
    }
    const leaked = '- `one\n- <analysis>SECRET</analysis> two`'.split('\n').join(eol)
    expect(stripModelScratchpadBlocks(leaked)).not.toContain('SECRET')
  })

  it.each([
    '- `one\n- <analysis>SECRET</analysis> two`',
    'Unmatched ` marker.\r# Heading\r<analysis>SECRET</analysis>\rLater ` span`'
  ])('does not shield analysis across sibling items or CR headings: %s', (input) => {
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
  })

  it.each([
    '- Example:\n  ```text\n  sample\n  ```\n<analysis>SECRET</analysis>',
    '> - Example:\n>   ~~~text\n>   sample\n<analysis>SECRET</analysis>',
    '1. Example:\n   ```text\n   sample\n<analysis>SECRET</analysis>',
    'Unmatched ` here\n## Heading\n<analysis>SECRET</analysis>\nLater `span`',
    'Unmatched ` here\n---\n<analysis>SECRET</analysis>\nLater `span`',
    '# Unmatched ` heading\n<analysis>SECRET</analysis>\nLater `span`'
  ])('does not let earlier Markdown leaves shield analysis: %s', (input) => {
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
  })
  it.each([
    '> Example:\n>  \n>     <thinking>literal</thinking>',
    '> > Example:\n> >   \n> >     <thinking>literal</thinking>',
    '> Example:\n> \t\n>     <thinking>literal</thinking>',
    '- Example:\n  ```xml\n  <thinking>literal</thinking>\n  ```'
  ])('keeps literal code inside continued containers: %s', (input) => {
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })

  it.each([
    ['inv_61b87d9e5c2a5062', '- Example:\n  ```text\n  sample\n<analysis>SECRET</analysis>\n<summary>Public</summary>'],
    [
      'inv_cf04a141422d97de',
      'An unmatched ` marker.\n# Section\n<analysis>SECRET</analysis>\nA later `example`.\n<summary>Public</summary>'
    ]
  ])('bounds inherited Markdown leaf blocks (%s)', (_id, input) => {
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
  })
  it('preserves quoted indented code after a padded blank quote (inv_876c5f283225867c)', () => {
    const input = '> Example:\n>  \n>     <thinking>literal</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
  })

  it.each([
    '> > ```text\n> > sample\n> outside\n<analysis>SECRET</analysis>',
    '- ```text\n  sample\n\n<analysis>SECRET</analysis>',
    '- ```text\n  sample\n- sibling\n<analysis>SECRET</analysis>',
    'An unmatched `` marker.\n \t\n<analysis>SECRET</analysis>\n\nLater ``example``.',
    '>     ```\n>     sample\n\n<analysis>SECRET</analysis>'
  ])('bounds nested/container Markdown masking: %s', (input) => {
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
  })

  it.each([
    ['inv_489f549a8bf0058e', '> ```text\n> sample\n\n<analysis>SECRET</analysis>\n<summary>Public</summary>'],
    ['inv_495ad080dbbb70d1', '    ```\n    sample\n\n<analysis>SECRET</analysis>\n<summary>Public</summary>'],
    ['inv_c7330e8558224a5f', 'An unmatched ` marker.\n\n<analysis>SECRET</analysis>\n\nA later `example` paragraph.']
  ])('does not shield later scratchpad across Markdown block boundaries (%s)', (_id, input) => {
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(stripModelScratchpadBlocks(`<summary>${input}</summary>`)).not.toContain('SECRET')
  })

  it('preserves tab-separated list fences without masking following analysis (inv_9c339ad57c3b09fa)', () => {
    const fence = '-\t```xml\n    <thinking>literal</thinking>\n    ```'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(fence)).toBe(fence)
    const result = stripModelScratchpadBlocks(`${fence}\n\n<analysis>SECRET</analysis>\n<summary>Public</summary>`)
    expect(result).toContain(fence)
    expect(result).not.toContain('SECRET')
    expect(result).toContain('Public')
  })

  it('keeps the line boundary between fenced and indented code (inv_732c4e7e9bebf1a7)', () => {
    const text = '```text\nfirst example\n```\n    <thinking>literal</thinking>'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(text)).toBe(text)
    expect(stripModelScratchpadBlocks(text)).toBe(text)
  })

  it('keeps scratchpad-shaped text inside ordinary tag attributes opaque (inv_ea9aab25c6ad4f7d)', () => {
    const markup = '<div title="<thinking>literal example</thinking>">Useful</div>'
    expect(stripModelScratchpadBlocks(`<summary>${markup}</summary>`)).toBe(markup)
  })

  it('closes tab-separated blockquote fences before stripping later analysis (inv_66012b96ffb82622)', () => {
    const visible = 'Keep\n\n>\t```xml\n>\t<example>literal</example>\n>\t```\n\n'
    const input = `<summary>${visible}<analysis>SECRET</analysis>\n\nDone.</summary>`
    const result = stripModelScratchpadBlocks(input)
    expect(result).not.toContain('SECRET')
    expect(result).not.toContain('<summary>')
    expect(result).toContain('>\t<example>literal</example>')
    expect(result).toContain('Done.')
  })

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

  it('does not treat self-closing scratchpad tags as open blocks (inv_ad4c45e6af29f23f)', () => {
    // A self-closing `<thinking/>` encloses nothing: treating it as an open
    // block makes fence masking search for a `</thinking>` that never comes
    // and hide the real `</analysis>` through EOF, so the whole private
    // analysis survives stripping and summarizeHistory() forwards it as
    // replacement context (cherry-pr-review inv_ad4c45e6af29f23f#f1).
    const input = '<analysis>private\n<thinking/>\n```text\ninternal content\n</analysis>\n<summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
    expect(stripModelScratchpadBlocks(input.replace('<thinking/>', '<assessment />'))).toBe('Keep')
  })

  it('strips scratchpad blocks whose tags carry slash-containing unquoted attributes (inv_2bc29d4d0ef02dc5)', () => {
    // An unquoted attribute value may contain '/': stopping the value scan at
    // the slash rejects the tag and the private block survives stripping,
    // reaching replacement context (cherry-pr-review inv_2bc29d4d0ef02dc5#f1).
    const input = '<analysis path=foo/bar>SECRET</analysis><summary>Visible</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Visible')
    expect(stripKnownModelScratchpadBlocks(input)).toBe('<summary>Visible</summary>')
  })

  it('recognizes a blockquote fence whose marker is followed by a tab (inv_8d793e19d8fb1409)', () => {
    // Markdown tab expansion makes '>\t' a valid container separator, like
    // '> ': rejecting it unmasks the fence and stripping deletes the literal
    // scratchpad example inside, corrupting the code block
    // (cherry-pr-review inv_8d793e19d8fb1409#f1).
    const fenced = '>\t```text\n> <thinking>literal</thinking>\n>\t```'
    expect(stripModelScratchpadBlocks(fenced)).toBe(fenced)
    expect(stripModelScratchpadBlocks('> ```text\n> <thinking>literal</thinking>\n> ```')).toBe(
      '> ```text\n> <thinking>literal</thinking>\n> ```'
    )
  })

  it('skips quoted attribute contents when tracking the enclosing scratchpad tag (inv_40ce8f82f82c9aee)', () => {
    // `<thinking>` inside a quoted attribute is attribute text, not a
    // wrapper: counting it keeps a phantom block open, fence masking hides
    // the real analysis boundary through EOF, and the private analysis
    // reaches replacement context (cherry-pr-review inv_40ce8f82f82c9aee#f1).
    const input = '<analysis>Private\n<div title="<thinking>">\n```text\nsecret\n</analysis>\n<summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
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

  it('treats a closing tag inside a longer inline-code span as literal content (inv_48f6cb86775e99c6)', () => {
    // The span swallows the first `</analysis>`: the real boundary is the
    // later unwrapped closer, and the internal tail must not survive.
    const input = '<analysis>Use `the </analysis> tag` in code. SECRET_INTERNAL_TEXT</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe('<summary>Keep</summary>')
  })

  it('keeps literal private-use placeholder tokens from the original text (inv_b4be6544122b016d)', () => {
    const literal = 'See \uE000INLINE_CODE_0\uE001 for the marker shape.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(literal)).toBe(literal)
    expect(stripModelScratchpadBlocks(literal)).toBe(literal)
    // With real inline code masked in the same pass, the literal token still survives.
    const mixed = 'Use `code` and \uE000INLINE_CODE_0\uE001 literally.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(mixed)).toBe(mixed)
    expect(stripModelScratchpadBlocks(mixed)).toBe(mixed)
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

  it('keeps container-prefixed fence markers as literal content of the outer fence (inv_896e68088dfc29d1)', () => {
    // Inside a top-level fence, a `> ``` or `- ``` line is literal content,
    // not the closing fence: accepting it as the closer exposes the remaining
    // fence content to scratchpad removal. A closer must share the opener's
    // container context.
    const blockquoted = 'Example:\n\n```\n> ```\n<thinking>literal example</thinking>\n```\n\nDone.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(blockquoted)).toBe(blockquoted)
    expect(stripModelScratchpadBlocks(blockquoted)).toBe(blockquoted)
    const listed = 'Example:\n\n```\n- ```\n<thinking>literal example</thinking>\n```\n\nDone.'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(listed)).toBe(listed)
    expect(stripModelScratchpadBlocks(listed)).toBe(listed)
    // A quoted fence still closes on a matching container prefix.
    const quoted = '> ```\n> <thinking>literal example</thinking>\n> ```\n\nVisible.'
    expect(stripModelScratchpadBlocks(quoted)).toContain('> <thinking>literal example</thinking>')
    expect(stripModelScratchpadBlocks(quoted)).toContain('Visible.')
  })

  it('ignores closing tags inside quoted attribute values when finding the block boundary (inv_2da074292d7f1ad1)', () => {
    // The `</analysis>` inside the div's title attribute is attribute content,
    // not the block boundary: stopping there leaves the internal tail (and the
    // real closer) in the output and defeats whole-summary unwrapping.
    const input = '<analysis>Use <div title="</analysis>"> in the example. SECRET</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
    expect(stripKnownModelScratchpadBlocks(input)).toBe('<summary>Keep</summary>')
  })

  it("treats a sibling list item fence as a new block, not the opener item's closer (inv_ef115bae05b2a143)", () => {
    // The second `- ``` line starts a sibling item; the first item's fence
    // closes implicitly at the item boundary. Accepting the sibling fence as
    // the closer unmasks the second block's content and deletes the literal
    // scratchpad-shaped XML inside it.
    const input = '- ```\n  first example\n- ```\n  <thinking>literal example</thinking>\n  ```'
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toContain('<thinking>literal example</thinking>')
  })

  it('recognizes indented code inside Markdown containers (inv_5cfd1b3f92913a5c)', () => {
    // `>     <thinking>...` is an indented code block inside a blockquote:
    // indentation counting must skip the container marker or the literal code
    // stays exposed to scratchpad removal. The bare `>` line is the
    // blockquote's blank line, so the quoted paragraph does not continue.
    const summary = '<summary>\n> Example:\n>\n>     <thinking>literal example</thinking>\n</summary>'
    expect(stripModelScratchpadBlocks(summary)).toContain('<thinking>literal example</thinking>')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(summary)).toContain(
      '<thinking>literal example</thinking>'
    )
    // List containers follow the same rule.
    const listed = '<summary>\n- Example:\n\n-     <thinking>literal example</thinking>\n</summary>'
    expect(stripModelScratchpadBlocks(listed)).toContain('<thinking>literal example</thinking>')
  })

  it('preserves scratchpad literals at every valid indented-code depth (inv_4ab3f6f347edda60)', () => {
    // CommonMark 0.31.2 §4.4: four or more columns - five spaces, eight
    // spaces, and repeated tabs are all valid indented code.
    for (const indent of ['     ', '        ', '\t\t']) {
      const input = `Example:\n\n${indent}<thinking>literal example</thinking>\n\nNext steps\u2026`
      expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toContain(
        '<thinking>literal example</thinking>'
      )
    }
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

  it.each(['2.', '42)', '0002.'])(
    'keeps inline spans across non-interrupting ordered markers %s (inv_efe376c40347676d)',
    (marker) => {
      const answer = 'Use `line\n' + marker + ' <analysis>literal</analysis>\nend`.'
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(answer)).toBe(answer)
      expect(stripModelScratchpadBlocks(answer)).toBe(answer)
    }
  )

  it('does not pair inline delimiters across ordered list siblings', () => {
    const input = '1. `unfinished\n2. <analysis>SECRET</analysis> closing`'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
  })

  it('preserves balanced protocol elements while removing unmatched suffixes (inv_e50b098aa3667988)', () => {
    for (const tag of ['tool_result', 'parameter', 'invoke', 'tool_calls']) {
      const balanced = `The response is <${tag}>ok</${tag}>`
      expect(stripTrailingToolProtocolClosingFragments(balanced)).toBe(balanced)
      expect(stripTrailingToolProtocolClosingFragments(balanced + '</invoke>')).toBe(balanced)
    }
  })

  it.each(['\n', '\r\n', '\r'])('preserves real nested-list code while stripping outer prose: %j', (eol) => {
    for (const source of [
      '- Parent\n  - Child\n\n        <analysis>literal</analysis>',
      '- Parent\n  - Child\n\n  Continued\n\n      <analysis>literal</analysis>'
    ]) {
      const input = source.split('\n').join(eol)
      expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
    }
  })

  it('returns to the containing list level after a nested item (inv_bb718394b9e39625)', () => {
    const input = '- Parent\n  - Child\n\n  Continued\n\n    <analysis>SECRET</analysis>'
    expect(stripModelScratchpadBlocks(input)).not.toContain('SECRET')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).not.toContain('SECRET')
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
  it('resolves the real scratchpad boundary instead of an inline-code mention in the following summary (inv_4b313ccdbd33f14b)', () => {
    const input =
      '<analysis>SECRET_INTERNAL\n```ts\nunfinished\n</analysis>\n<summary>\n```ts\nshown\n```\nExample `</analysis>`\n</summary>'
    const out = stripModelScratchpadBlocks(input)
    expect(out).not.toContain('SECRET_INTERNAL')
    expect(out).toContain('shown')
    expect(out).toContain('Example')
  })

  it('counts mixed space/tab indentation with CommonMark tab stops (inv_c51149ed55871417)', () => {
    const input = 'Example:\n\n   \t<thinking>literal example</thinking>'
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toContain('<thinking>literal example</thinking>')
    expect(stripModelScratchpadBlocks(input)).toContain('<thinking>literal example</thinking>')
  })

  it('keeps backslash-escaped tool closing tags as literal text (inv_c4d88ac9b0f0f954)', () => {
    expect(stripTrailingToolProtocolClosingFragments('Answer \\</parameter>')).toBe('Answer \\</parameter>')
    expect(stripTrailingToolProtocolClosingFragments('Answer \\</parameter> </invoke name="x">')).toBe(
      'Answer \\</parameter>'
    )
  })

  it('applies code-span delimiter rules when locating the real scratchpad closer (inv_ccf2d4de8815a708)', () => {
    // A backslash does not escape a closing backtick INSIDE a code span: the
    // span completes after `tag\`, the </analysis> inside it is literal, and
    // the real wrapper boundary is the later unwrapped closer.
    const input = '<analysis>Use `the </analysis> tag\\` in code. INTERNAL_TEXT</analysis><summary>Keep</summary>'
    expect(stripModelScratchpadBlocks(input)).toBe('Keep')
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe('<summary>Keep</summary>')
  })

  it('treats a heading as a closed block so following indented scratchpad literals stay code (inv_0847c277aaa83851)', () => {
    // CommonMark: the ATX heading closes its block, so the four-space line is
    // indented code and its literal XML must survive.
    const input = '# Example\n    <thinking>literal example</thinking>'
    expect(stripModelScratchpadBlocks(input)).toBe(input)
    expect(stripKnownModelScratchpadBlocksPreservingCodeFences(input)).toBe(input)
  })
})
