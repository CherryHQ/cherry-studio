import { describe, expect, it } from 'vitest'

import { ContextPrompts } from '../prompts'
import { maskIndentedCodeBlocks, maskIndentedCodeBlocksReference, stripModelScratchpadBlocks } from '../scratchpadText'

// cherry-review findings on head ce6f904e6b (heading boundary, quoted-list
// ownership, placeholder exhaustion). Each input was clean on the merge base.
describe('scratchpad strip review regressions', () => {
  it('does not let a sibling dash underline an unreachable list paragraph', () => {
    for (const raw of [
      '* star\n-\n    <thinking>SECRET</thinking>\n',
      '- a\n-\n    <thinking>SECRET</thinking>\n',
      '1. item\n-\n    <thinking>SECRET</thinking>\n',
      '* star\n-  \n    <thinking>SECRET</thinking>\n',
      '* star\n -\n    <thinking>SECRET</thinking>\n',
      '- list para\n-\t\n    <thinking>SECRET</thinking>\n'
    ]) {
      expect(ContextPrompts.formatCompactSummary(raw)).not.toContain('SECRET')
      expect(maskIndentedCodeBlocks(raw).text).toBe(maskIndentedCodeBlocksReference(raw).text)
    }
  })
  it('keeps quote-container and empty-marker setext privacy boundaries', () => {
    for (const raw of [
      '> quoted para\n-\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n- \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n-\t\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n - \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n -\t\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -\n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  - \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -  \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -   \n    <thinking>SECRET</thinking>\n',
      '> quoted para\n  -\t\n    <thinking>SECRET</thinking>\n',
      '-\n- \n    <analysis>SECRET</analysis>\n',
      '# H\n \n-\n- \n    <analysis>SECRET</analysis>\n'
    ]) {
      expect(ContextPrompts.formatCompactSummary(raw)).not.toContain('SECRET')
      expect(maskIndentedCodeBlocks(raw).text).toBe(maskIndentedCodeBlocksReference(raw).text)
    }
  })
  it('preserves newly opened quoted code after changing list type', () => {
    const raw =
      '-\t tabitem\n   ind3\n- > A\n+ plus\n  >     <analysis>SECRET</analysis>\n- > a\n  >     <analysis>SECRET</analysis>\n'
    const out = ContextPrompts.formatCompactSummary(raw)
    expect(out.match(/SECRET/g)?.length).toBe(1)
    expect(out).toContain('+ plus\n  >     <analysis>SECRET</analysis>')
  })
  it('does not treat an underline outside its quoted paragraph or after an empty item as setext', () => {
    for (const prefix of ['> quoted para\n', '-\n', '- \n']) {
      for (const marker of ['-', '- ', '-  ', '-\t', ' - ', '  - ']) {
        const raw = prefix + marker + '\n    <thinking>SECRET</thinking>\n'
        expect(ContextPrompts.formatCompactSummary(raw), JSON.stringify(raw)).not.toContain('SECRET')
      }
    }
  })
  it('removes quoted-list paragraph analysis from the actual compact-summary formatter', () => {
    expect(ContextPrompts.formatCompactSummary('- > A\n  >     <analysis>SECRET</analysis>')).toBe(
      '- > A\n  >     '.trimEnd()
    )
  })
  it('preserves code after a single-hyphen setext heading in both scanners', () => {
    for (const underline of ['-', '- ', '-  ', '-   ', '--', '-- ', '===']) {
      const raw = `Title\n${underline}\n    <thinking>literal example</thinking>\n`
      expect(stripModelScratchpadBlocks(raw), JSON.stringify(underline)).toBe(raw.trimEnd())
      expect(maskIndentedCodeBlocks(raw).text).toBe(maskIndentedCodeBlocksReference(raw).text)
    }
  })
  it('keeps indented code after an unindented heading that follows a list', () => {
    const input = '- A\n# H\n    <thinking>literal</thinking>\n'
    expect(stripModelScratchpadBlocks(input)).toBe('- A\n# H\n    <thinking>literal</thinking>')
  })

  it('keeps indented code after an unindented thematic break that follows a list', () => {
    const input = '- A\n***\n    <thinking>literal</thinking>\n'
    expect(stripModelScratchpadBlocks(input)).toBe('- A\n***\n    <thinking>literal</thinking>')
  })

  it('still strips a paragraph tag indented under a list item', () => {
    expect(stripModelScratchpadBlocks('- A\n  <thinking>x</thinking> tail\n')).toBe('- A\n   tail')
  })

  it('does not keep private analysis inside a quoted list that starts outside an earlier list', () => {
    const input = '- A\n> - A\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>'
    const out = stripModelScratchpadBlocks(input)
    expect(out).not.toContain('SECRET')
    expect(out).toContain('<summary>Public</summary>')
  })

  it('keeps a quote nested inside the outer list item owning it', () => {
    const input = '- A\n\n  > - B\n\n  >     <analysis>keep</analysis>\n'
    expect(stripModelScratchpadBlocks(input)).toContain('<analysis>keep</analysis>')
  })

  it('preserves literal placeholder tokens when all four preferred bases occur in the input', () => {
    const tokens = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}INLINE_CODE_0\uE001`).join(' ')
    const input = `${tokens} \`code\` tail`
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  })

  it('stays collision-free when every single-character placeholder base occurs literally', () => {
    const occupied = (kind: string) => {
      let out = ''
      for (let code = 0xe000; code < 0xf8ff; code += 2) out += `${String.fromCharCode(code)}${kind}_0\uE001`
      return out
    }
    for (const [kind, body, expected] of [
      ['INLINE_CODE', '`code` tail', '`code` tail'],
      [
        'CODE_FENCE',
        '\n```\n<thinking>x</thinking>\n```\n<thinking>y</thinking> tail',
        '\n```\n<thinking>x</thinking>\n```\n tail'
      ],
      [
        'INDENTED_CODE',
        '\n\n    <thinking>x</thinking>\n\n<thinking>y</thinking>tail',
        '\n\n    <thinking>x</thinking>\n\ntail'
      ]
    ] as const) {
      const literal = occupied(kind)
      expect(stripModelScratchpadBlocks(literal + body)).toBe(literal + expected)
    }
  })

  it('formatCompactSummary pins the exact output for the reviewer inputs', () => {
    const f = ContextPrompts.formatCompactSummary
    // Heading keeps its literal indented code.
    expect(f('- A\n# H\n    <thinking>literal</thinking>\n')).toBe('- A\n# H\n    <thinking>literal</thinking>')
    // Private analysis is removed. The summary tags stay because the PR only unwraps a
    // summary that wraps the whole output (the merge base used a naive regex extraction
    // and returned the bare "Public").
    expect(f('- A\n> - A\n>     <analysis>SECRET</analysis>\n\n<summary>Public</summary>')).toBe(
      '- A\n> - A\n>     \n\n<summary>Public</summary>'
    )
    // The input with no inner list marker is a quote holding indented code: preserved by design.
    expect(f('- A\n>     <analysis>kept</analysis>\n')).toBe('- A\n>     <analysis>kept</analysis>')
  })

  it('handles one-space, nested and setext heading shapes after a list', () => {
    const f = ContextPrompts.formatCompactSummary
    expect(f('- A\n # H\n    <thinking>x</thinking> tail\n')).toBe('- A\n # H\n    <thinking>x</thinking> tail')
    expect(f('- A\n  # H\n      <thinking>x</thinking> tail\n')).toBe('- A\n  # H\n      <thinking>x</thinking> tail')
    // A setext heading makes the following indented line a paragraph, so the tag is stripped.
    expect(f('- A\nH\n===\n    <thinking>x</thinking> tail\n')).toBe('- A\nH\n===\n     tail')
  })

  it('ownership: reference and stepped maskers agree and drop only unreached outer lists', () => {
    const cases: Array<[string, string]> = [
      ['- A\n  > - B\n  >     <analysis>q</analysis>\n', '- A\n  > - B\n  >'],
      ['1. A\n  > - B\n  >     <analysis>q</analysis>\n', '1. A\n  > - B\n  >'],
      ['> - A\n> > - B\n> >     <analysis>q</analysis>\n', '> - A\n> > - B\n> >'],
      ['- A\n>     <analysis>SECRET</analysis>\n', '- A\n>     <analysis>SECRET</analysis>']
    ]
    for (const [input, expected] of cases) {
      expect(maskIndentedCodeBlocks(input).text).toBe(maskIndentedCodeBlocksReference(input).text)
      expect(ContextPrompts.formatCompactSummary(input)).toBe(expected)
    }
  })

  it('placeholder allocation is collision-free for fence and indented kinds with closers and long runs', () => {
    const base = '\uE000'
    // Many literal tokens with a long run of the first base, for every mask kind.
    for (const [kind, body, expected] of [
      ['INLINE_CODE', '`code` tail', '`code` tail'],
      [
        'CODE_FENCE',
        '\n```\n<thinking>x</thinking>\n```\n<thinking>y</thinking> tail',
        '\n```\n<thinking>x</thinking>\n```\n tail'
      ],
      [
        'INDENTED_CODE',
        '\n\n    <thinking>x</thinking>\n\n<thinking>y</thinking>tail',
        '\n\n    <thinking>x</thinking>\n\ntail'
      ]
    ] as const) {
      let literal = ''
      let count = 0
      for (let code = 0xe000; code < 0xf8ff; code += 2, count++)
        literal += `${String.fromCharCode(code)}${kind}_0\uE001`
      // Every even private-use code point is a candidate base, 3200 of them: all occupied.
      expect(count).toBe(3200)
      literal += `${base.repeat(5)}${kind}_0\uE001${base.repeat(2)}${kind}_9\uE001`
      expect(stripModelScratchpadBlocks(literal + body)).toBe(literal + expected)
    }
  })

  it('keeps a long private-use run without a placeholder needle linear and intact', () => {
    const run = '\uE000'.repeat(300000) + 'x\uE001'.repeat(1000)
    const input = `${run} \`code\` tail`
    // No wall-clock assertion (runner speed varies): the quadratic regex this guards against
    // ran past 100 s on this input, so the generous test timeout is the gate.
    expect(stripModelScratchpadBlocks(input)).toBe(input)
  }, 60000)

  it('round-trips literal multi-private-use CODE_FENCE tokens next to a real fence', () => {
    const lit = '\uE000\uE000CODE_FENCE_1\uE001'
    const all = ['\uE000', '\uE002', '\uE004', '\uE006'].map((b) => `${b}CODE_FENCE_1\uE001`).join('')
    const input = `${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n<thinking>y</thinking> tail`
    const out = stripModelScratchpadBlocks(input)
    expect(out).toBe(`${all}${lit}\n- A\n${lit}\n\n\`\`\`\n<thinking>x</thinking>\n\`\`\`\n tail`)
  })
})

describe('HTML text body fence ownership', () => {
  it('does not let literal HTML in a real fence own later Markdown code', () => {
    const raw = '```\n<textarea>\n```\n\n```\n<analysis>literal</analysis>\n```\n<analysis>SECRET</analysis>'
    expect(ContextPrompts.formatCompactSummary(raw)).toBe(
      '```\n<textarea>\n```\n\n```\n<analysis>literal</analysis>\n```'
    )
  })
  it('formatCompactSummary removes analysis following literal text-element ticks', () => {
    for (const tag of ['textarea', 'script', 'style', 'title']) {
      const raw = `<${tag}>\n\`\`\`\n</${tag}>\n<analysis>SECRET</analysis>\n<summary>Public</summary>`
      expect(ContextPrompts.formatCompactSummary(raw)).toBe(`<${tag}>\n\`\`\`\n</${tag}>\n\n<summary>Public</summary>`)
    }
  })
})

describe('HTML body inline-tick ownership', () => {
  it('formatCompactSummary removes real analysis after closed literal bodies containing ticks', () => {
    for (const tag of ['textarea', 'script', 'style', 'title']) {
      expect(
        ContextPrompts.formatCompactSummary(
          `<summary>Keep<${tag}>\`</${tag}><analysis>SECRET</analysis> public \`x\`</summary>`
        )
      ).toBe(`Keep<${tag}>\`</${tag}> public \`x\``)
    }
  })
})

describe('literal body ownership boundaries', () => {
  it('keeps later actual code spans after code-literal HTML tags', () => {
    for (const lead of ['`<textarea>` ', '```\n<textarea>\n```\n\n']) {
      const raw = lead + '`<analysis>literal</analysis>` <analysis>SECRET</analysis>'
      expect(ContextPrompts.formatCompactSummary(raw)).toBe((lead + '`<analysis>literal</analysis>`').trim())
    }
  })
})

describe('summary fence HTML literal boundary', () => {
  it('strips real analysis after a fenced HTML opener', () => {
    const raw = '<summary>```html\n<textarea>\n```\n<analysis>SECRET</analysis> `<analysis>lit</analysis>`</summary>'
    expect(ContextPrompts.formatCompactSummary(raw)).toBe('```html\n<textarea>\n```\n `<analysis>lit</analysis>`')
    expect(ContextPrompts.formatCompactSummary(raw.replace('<summary>', '<summary>\n'))).toBe(
      '```html\n<textarea>\n```\n `<analysis>lit</analysis>`'
    )
  })
})

describe('inline body lookup scaling', () => {
  it('bounds repeated inline code with interleaved HTML', () => {
    const raw = '<summary>' + 'word `code` more <b>x</b> '.repeat(2000) + '</summary>'
    const start = performance.now()
    expect(ContextPrompts.formatCompactSummary(raw)).toBe(raw.slice(9, -10).trim())
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

describe('summary envelope normalization order', () => {
  it('pins nested whole-envelope unwrapping before and after cleanup', () => {
    expect(ContextPrompts.formatCompactSummary('<summary><summary>Public</summary></summary>')).toBe('Public')
  })
})

describe('code-literal HTML before tilde fence', () => {
  it('formatCompactSummary preserves the real fenced example', () => {
    const raw = 'Use `<textarea>`\n\n~~~xml\n<thinking>LITERAL</thinking>\n~~~'
    expect(ContextPrompts.formatCompactSummary(raw)).toBe(raw)
  })
})

describe('thematic break precedence', () => {
  it('keeps indented code after spaced thematic breaks in formatter and both masks', () => {
    for (const marker of ['* * *', '- - -', '_ _ _']) {
      const raw = marker + '\n\n    <thinking>LITERAL</thinking>\n'
      expect(ContextPrompts.formatCompactSummary(raw)).toBe(raw.trimEnd())
      expect(maskIndentedCodeBlocks(raw).text).toBe(maskIndentedCodeBlocksReference(raw).text)
    }
  })
})

describe('thematic leaf boundary before list classification', () => {
  it('preserves no-blankline and prior-list thematic code shapes', () => {
    for (const marker of ['* * *', '- - -', '_ _ _'])
      for (const lead of ['', '- x\n', '1. a\n'])
        for (const blank of ['', '\n']) {
          const raw = lead + marker + '\n' + blank + '    <thinking>L</thinking>\n'
          expect(ContextPrompts.formatCompactSummary(raw)).toBe(raw.trimEnd())
        }
  })
})

describe('thematic reference parity', () => {
  it('agrees on tabs and quote/container thematic boundaries', () => {
    for (const raw of [
      '-\t-\t-\n    <thinking>LIT</thinking>\n',
      '> * * *\n>     <thinking>LIT</thinking>\n',
      '- x\n  * * *\n      <thinking>LIT</thinking>\n'
    ]) {
      expect(maskIndentedCodeBlocks(raw).text).toBe(maskIndentedCodeBlocksReference(raw).text)
    }
  })
})

it('preserves five-space list padding literal code through compact-summary formatting', () => {
  const input = '-     x\n     ~~~xml\n  <thinking>LITERAL</thinking>\n     ~~~\n'
  expect(ContextPrompts.formatCompactSummary(input)).toContain('LITERAL')
})
it.each([
  '- x\n  > ~~~xml\n    <analysis>SECRET</analysis>\n  > ~~~\n',
  '- x\n  10. ~~~xml\n      <analysis>SECRET</analysis>\n  10. ~~~\n'
])('strips private analysis after invalid fence ownership: %s', (input) => {
  expect(ContextPrompts.formatCompactSummary(input)).not.toContain('SECRET')
})

it('expires outer list ownership at a quote opened before its content column', () => {
  const raw = '- item\n>\n  ```\n<analysis>MARK</analysis>\n  ```\n'
  expect(ContextPrompts.formatCompactSummary(raw)).toContain('<analysis>MARK</analysis>')
})
it('keeps the outer list when its quote child ends before a continuation fence', () => {
  const result = ContextPrompts.formatCompactSummary(
    '- > item\n  ```\n<analysis>MARK</analysis>\n\n<summary>Public</summary>'
  )
  expect(result).not.toContain('MARK')
  expect(result).toContain('Public')
})

it('expires an empty list at its blank boundary before a top-level literal fence', () => {
  expect(ContextPrompts.formatCompactSummary('-\n  \n  ```\n<analysis>MARK</analysis>\n  ```\n')).toContain(
    '<analysis>MARK</analysis>'
  )
})
it('does not protect private analysis with an indented non-fence after an empty item', () => {
  expect(ContextPrompts.formatCompactSummary('-\n  \n    ~~~\n  <analysis>MARK</analysis>\n')).not.toContain('MARK')
})

it.each([
  ['-  \n  ~~~\n<analysis>MARK</analysis>\n', false],
  ['-  \n   ~~~\n  <analysis>MARK</analysis>\n', true]
])('uses one content-padding column for an empty marker: %s', (raw, literal) => {
  expect(ContextPrompts.formatCompactSummary(raw).includes('MARK')).toBe(literal)
})

it('does not treat an empty marker that cannot interrupt a paragraph as a new item', () => {
  expect(
    ContextPrompts.formatCompactSummary('- x\n  *    \n      ~~~\n       <analysis>MARK</analysis>\n')
  ).not.toContain('MARK')
})

it.each([
  ['- item\n  para\n  - \n     +  text\n        ````\n \t<analysis>MARK</analysis>\n        ````\ntail\n', false],
  ['- item\n  para\n   -\n     2)    \n        ```\n \t<analysis>MARK</analysis>\n        ```\n', false],
  ['- x\n  *\n      ~~~\n       <analysis>MARK</analysis>\n', false],
  ['1. x\n    1)  \n        ~~~\n       <analysis>MARK</analysis>\n        ~~~\n', false],
  ['- item\n  para\n  *\n      ```\n  <analysis>MARK</analysis>\n      ```\n', true],
  ['- a\n  - b\n    para text\n    1. \n\t\t```\n      <analysis>MARK</analysis>\n\t\t```\n', true]
])('classifies paragraph marker text without phantom list ownership: %s', (raw, literal) => {
  expect(ContextPrompts.formatCompactSummary(raw).includes('MARK')).toBe(literal)
})

it('retains indented literal XML after an invalid backtick fence and setext underline', () => {
  const raw = '```aa```\n-\n    <thinking>literal</thinking>\n'
  expect(ContextPrompts.formatCompactSummary(raw)).toContain('<thinking>literal</thinking>')
})

it('does not let invalid lazy fence info drop an existing list fence boundary', () => {
  const raw = '- x\n```aa```\n    ```\n<analysis>MARK</analysis>\n``` a`b\n`'
  expect(ContextPrompts.formatCompactSummary(raw)).not.toContain('MARK')
})

it.each(['--', '==='])('retains an inline literal across invalid fence/list lines: %s', (underline) => {
  const raw = `- x\n\x60\x60\x60 a\x60b\n\t\t<analysis>MARK</analysis>\n${underline}\n\x60\x60\x60aa\x60\x60\x60\n`
  expect(ContextPrompts.formatCompactSummary(raw)).toContain('MARK')
})

it('preserves inline literal ownership across lazy quote continuation', () => {
  const raw = '> x\n    `\n> <thinking>MARK</thinking>\n    `\n'
  expect(ContextPrompts.formatCompactSummary(raw)).toContain('<thinking>MARK</thinking>')
})

it.each([
  ['    plain\n2. ``` a`b\n2. `<thinking>MARK</thinking>`\n', 'plain\n2. ``` a`b\n2. `<thinking>MARK</thinking>`'],
  ['> <div>\n`open\n2. `<thinking>MARK</thinking>`\n', '> <div>\n`open\n2. ``'],
  ['- `\r\n    <p>\r\n  `<thinking>MARK</thinking>`\r\n', '- `\r\n    <p>\r\n  ``'],
  ['> text\n</script>\n> `<thinking>MARK</thinking>`\n', '> text\n</script>\n> `<thinking>MARK</thinking>`'],
  ['> text\n</pre>\n> `<thinking>MARK</thinking>`\n', '> text\n</pre>\n> `<thinking>MARK</thinking>`'],
  ['> text\n</style>\n> `<thinking>MARK</thinking>`\n', '> text\n</style>\n> `<thinking>MARK</thinking>`'],
  ['> text\n<source>\n> `<thinking>MARK</thinking>`\n', '> text\n<source>\n> `<thinking>MARK</thinking>`'],
  ['> text\n</source>\n> `<thinking>MARK</thinking>`\n', '> text\n</source>\n> `<thinking>MARK</thinking>`'],
  ['</div>\n> text\n`open\n2. `<thinking>MARK</thinking>`\n', '</div>\n> text\n`open\n2. ``'],
  ['<div>\n> text\n`<thinking>MARK</thinking>\n> quoted `code`\n', '<div>\n> text\n`\n> quoted `code`'],
  ['<?php echo\n> > nested\n``` a`b\n2. `<thinking>MARK</thinking>`\n', '<?php echo\n> > nested\n``` a`b\n2. ``'],
  ['<pre>\ntext\n2. ``` a`b\n`<thinking>MARK</thinking>`\n2. ``` a`b\n', '<pre>\ntext\n2. ``` a`b\n``\n2. ``` a`b'],
  ['<pre>\n</textarea>\n`<analysis>MARK</analysis>`\n', '<pre>\n</textarea>\n`<analysis>MARK</analysis>`'],
  ['> <section>\n\t`<thinking>MARK</thinking>\na `b` c\n', '> <section>\n\t`<thinking>MARK</thinking>\na `b` c'],
  ['>> <ul>\n> > x\n``<analysis>MARK</analysis>``\n', '>> <ul>\n> > x\n``<analysis>MARK</analysis>``'],
  [
    '> 2. <summary>\n\t`<thinking>MARK</thinking>\ntext `tick` more\n',
    '> 2. <summary>\n\t`<thinking>MARK</thinking>\ntext `tick` more'
  ],
  [
    '2. 2. item\n   <li>\n   text\n``<thinking>MARK</thinking>``\n',
    '2. 2. item\n   <li>\n   text\n``<thinking>MARK</thinking>``'
  ],
  ['>> <table>\n>> `open\n> `<thinking>MARK</thinking>`\n', '>> <table>\n>> `open\n> `<thinking>MARK</thinking>`'],
  ['`<thinking>MARK</thinking>\r\n<frame>\r\n``` a`b\r\n', '`\r\n<frame>\r\n``` a`b'],
  ['`\n<analysis>MARK</analysis>\n<frame>\n`open\n', '`\n\n<frame>\n`open'],
  ['+ <source>\r\n  <li>\r\n``` a`b\r\n2. `<thinking>MARK</thinking>`\r\n', '+ <source>\r\n  <li>\r\n``` a`b\r\n2. ``'],
  ['> <em>\n>> `<thinking>MARK</thinking>\n> text `tick` more\n', '> <em>\n>> `\n> text `tick` more']
])('keeps the existing policy outside lazy paragraph repair: %s', (raw, expected) => {
  expect(stripModelScratchpadBlocks(raw)).toBe(expected)
})

it.each([
  [
    '> x\r\n  `open\r\n2. item\r\n> `<thinking>MARK</thinking>\r\n  `open\r\n',
    '> x\r\n  `open\r\n2. item\r\n> `<thinking>MARK</thinking>\r\n  `open'
  ],
  ['>> z\n    `<thinking>MARK</thinking>\n2. item\n> > nested `d`\n', '>> z\n    `\n2. item\n> > nested `d`'],
  ['> x\n    `\n===\n2. item\n    <thinking>MARK</thinking>\n\t`\n', '> x\n    `\n===\n2. item\n    \n\t`'],
  [
    '>> z\r\n  `open\r\n    ``\r\n===\r\n  ``<thinking>MARK</thinking>``\r\n> quoted `code`\r\n',
    '>> z\r\n  `open\r\n    ``\r\n===\r\n  ``<thinking>MARK</thinking>``\r\n> quoted `code`'
  ],
  [
    '>> z\n    `\n> `\n--\n    `<thinking>MARK</thinking>\n    `\n',
    '>> z\n    `\n> `\n--\n    `<thinking>MARK</thinking>\n    `'
  ],
  [
    '>> z\n> quoted `code`\n    `\n> > nested `d`\nlazy `\n===\n    `<thinking>MARK</thinking>\nlazy `\n',
    '>> z\n> quoted `code`\n    `\n> > nested `d`\nlazy `\n===\n    `<thinking>MARK</thinking>\nlazy `'
  ],
  ['>> z\n    `\n> `\n--\n`<thinking>MARK</thinking>`\n', '>> z\n    `\n> `\n--\n`<thinking>MARK</thinking>`'],
  [
    '>> z\n    `\n--\nx `<thinking>MARK</thinking>` y\n> quoted `code`\n    `\n`<thinking>MARK</thinking>`\n',
    '>> z\n    `\n--\nx `<thinking>MARK</thinking>` y\n> quoted `code`\n    `\n``'
  ],
  ['> ``\n--\n2. item\n> ``<thinking>MARK</thinking>``\n', '> ``\n--\n2. item\n> ``<thinking>MARK</thinking>``'],
  [
    '> x\r\n    `\r\n2. item\r\n> x `<thinking>MARK</thinking>` y\r\n',
    '> x\r\n    `\r\n2. item\r\n> x `<thinking>MARK</thinking>` y'
  ],
  [
    '>> z\n  `open\n2. item\n--\n    `<thinking>MARK</thinking>`\n',
    '>> z\n  `open\n2. item\n--\n    `<thinking>MARK</thinking>`'
  ],
  [
    '> a `b`\n2. item\n--\nlazy `\n> `<analysis>MARK</analysis>`\n',
    '> a `b`\n2. item\n--\nlazy `\n> `<analysis>MARK</analysis>`'
  ],
  [
    '>> z\n  `open\n> quoted `code`\n    `\n===\n  `<analysis>MARK</analysis>`\n',
    '>> z\n  `open\n> quoted `code`\n    `\n===\n  `<analysis>MARK</analysis>`'
  ],
  [
    '> a `b`\n===\nlazy `\n2. item\n> ``\n`<analysis>MARK</analysis>`\n',
    '> a `b`\n===\nlazy `\n2. item\n> ``\n`<analysis>MARK</analysis>`'
  ],
  [
    '>> z\n    `\n2. item\n--\n    x `<thinking>MARK</thinking>` y\n',
    '>> z\n    `\n2. item\n--\n    x `<thinking>MARK</thinking>` y'
  ],
  [
    '> x\n\t`\n> x `<thinking>MARK</thinking>` y\n2. item\n    x `<thinking>MARK</thinking>` y\n',
    '> x\n\t`\n> x `<thinking>MARK</thinking>` y\n2. item\n    x `<thinking>MARK</thinking>` y'
  ],
  [
    '>> z\n    `\n> > nested `d`\n`<analysis>MARK</analysis>`\n> `\n> `<analysis>MARK</analysis>`\n',
    '>> z\n    `\n> > nested `d`\n`<analysis>MARK</analysis>`\n> `\n> ``'
  ],
  [
    '> x\r\n\t`\r\n2. item\r\n  <thinking>MARK</thinking>\r\n> quoted `code`\r\n',
    '> x\r\n\t`\r\n2. item\r\n  \r\n> quoted `code`'
  ],
  [
    '1. > 2. qord\n``` a`b\n> x `<thinking>MARK</thinking>` y\n',
    '1. > 2. qord\n``` a`b\n> x `<thinking>MARK</thinking>` y'
  ],
  ['> <thinking>MARK</thinking>\n`<thinking>MARK</thinking>\n2. item\n> close`\n', '> \n`\n2. item\n> close`'],
  [
    '> a `b`\n2. item\n  `open\n===\n> `<thinking>MARK</thinking>`\n',
    '> a `b`\n2. item\n  `open\n===\n> `<thinking>MARK</thinking>`'
  ],
  [
    '>> <thinking>MARK</thinking>\r\n\t`\r\n>> `<thinking>MARK</thinking>`\r\n2. x `<thinking>MARK</thinking>` y\r\n',
    '>> \r\n\t`\r\n>> `<thinking>MARK</thinking>`\r\n2. x `<thinking>MARK</thinking>` y'
  ],
  [
    '> text `t`\r\nlazy `\r\n--\r\n> ``\r\n    ``<thinking>MARK</thinking>``\r\n2. item\r\n    `\r\n',
    '> text `t`\r\nlazy `\r\n--\r\n> ``\r\n    ````\r\n2. item\r\n    `'
  ],
  ['>> z\n  `open\n> `<thinking>MARK</thinking>\n===\n  `open\n', '>> z\n  `open\n> `\n===\n  `open'],
  [
    '>> deep\n    `\n2. item\n>> x `<thinking>MARK</thinking>` y\n',
    '>> deep\n    `\n2. item\n>> x `<thinking>MARK</thinking>` y'
  ],
  [
    '> text `t`\n\t`\n2. item\n===\n  `<thinking>MARK</thinking>\n    `\n',
    '> text `t`\n\t`\n2. item\n===\n  `<thinking>MARK</thinking>\n    `'
  ],
  [
    '> x\n    `\n2. item\n    <thinking>MARK</thinking>\n> quoted `code`\n',
    '> x\n    `\n2. item\n    \n> quoted `code`'
  ],
  [
    '> x\r\n    ``\r\n2. item\r\n> <assessment>MARK</assessment>\r\n    ``\r\n',
    '> x\r\n    ``\r\n2. item\r\n> \r\n    ``'
  ],
  [
    '> text `t`\nlazy `\n2. item\n> <assessment>MARK</assessment>\n===\n  `open\n',
    '> text `t`\nlazy `\n2. item\n> \n===\n  `open'
  ],
  [
    '> > inner\r\n\t`\r\n> close`\r\n===\r\n<assessment>MARK</assessment>\r\n\t`\r\n',
    '> > inner\r\n\t`\r\n> close`\r\n===\r\n\r\n\t`'
  ],
  [
    '>> z\nlazy `\n2. item\n    `\nlazy `\n<assessment>MARK</assessment>\n> > nested `d`\n',
    '>> z\nlazy `\n2. item\n    `\nlazy `\n\n> > nested `d`'
  ],
  ['> > `<thinking>MARK</thinking>\r\n--\r\n2. - y `tick`\r\n', '> > `\r\n--\r\n2. - y `tick`'],
  [
    '>> z\r\n  `<thinking>MARK</thinking>\r\n2. item\r\n> > inner\r\n  `open\r\n',
    '>> z\r\n  `\r\n2. item\r\n> > inner\r\n  `open'
  ],
  ['> `\n--\n2. item\n    `<analysis>MARK</analysis>`\n', '> `\n--\n2. item\n    `<analysis>MARK</analysis>`'],
  [
    '> text `t`\n  `open\n--\n2. item\n    `<analysis>MARK</analysis>`\n',
    '> text `t`\n  `open\n--\n2. item\n    `<analysis>MARK</analysis>`'
  ],
  ['>> z\n\t`\n  <assessment>MARK</assessment>\n2. item\n> > nested `d`\n', '>> z\n\t`\n  \n2. item\n> > nested `d`'],
  [
    '> x\n    `\n2. item\n> x `<thinking>MARK</thinking>` y\n',
    '> x\n    `\n2. item\n> x `<thinking>MARK</thinking>` y'
  ],
  [
    '> `\r\n2. item\r\n--\r\n  x `<thinking>MARK</thinking>` y\r\n',
    '> `\r\n2. item\r\n--\r\n  x `<thinking>MARK</thinking>` y'
  ],
  ['>> z\r\n\t`\r\n> `<thinking>MARK</thinking>\r\n===\r\n    `\r\n', '>> z\r\n\t`\r\n> `\r\n===\r\n    `'],
  [
    '> >> deep\r\n  `<thinking>MARK</thinking>\r\n=\r\n2. text `tick` more\r\n',
    '> >> deep\r\n  `\r\n=\r\n2. text `tick` more'
  ],
  [
    '>> z\n  `open\n===\n2. item\n`<analysis>MARK</analysis>`\n',
    '>> z\n  `open\n===\n2. item\n`<analysis>MARK</analysis>`'
  ],
  [
    '> ``\r\n2. item\r\n===\r\n> ``<thinking>MARK</thinking>``\r\n',
    '> ``\r\n2. item\r\n===\r\n> ``<thinking>MARK</thinking>``'
  ],
  ['> a `b`\n    `\n2. item\n--\n  <thinking>MARK</thinking>\n    `\n', '> a `b`\n    `\n2. item\n--\n  \n    `'],
  [
    '>> z\nlazy `\n<thinking>MARK</thinking>\n> > inner\n2. item\nlazy `\n',
    '>> z\nlazy `\n\n> > inner\n2. item\nlazy `'
  ],
  [
    '> x\n  `open\n===\n2. item\n  `<thinking>MARK</thinking>`\n',
    '> x\n  `open\n===\n2. item\n  `<thinking>MARK</thinking>`'
  ],
  [
    '> text `t`\r\n2. item\r\n  `open\r\n> quoted `code`\r\n===\r\n  <assessment>MARK</assessment>\r\n    `\r\n',
    '> text `t`\r\n2. item\r\n  `open\r\n> quoted `code`\r\n===\r\n  \r\n    `'
  ],
  ['> x\n    `<thinking>MARK</thinking>\n2. item\n> quoted `code`\n', '> x\n    `\n2. item\n> quoted `code`'],
  [
    '> quoted `code`\n\t`\n--\n2. item\n> `<analysis>MARK</analysis>`\n',
    '> quoted `code`\n\t`\n--\n2. item\n> `<analysis>MARK</analysis>`'
  ],
  [
    '>> z\n    `\n===\n    `<thinking>MARK</thinking>`\n> <thinking>MARK</thinking>\n  `open\n',
    '>> z\n    `\n===\n    `<thinking>MARK</thinking>`\n> \n  `open'
  ],
  ['>> z\n    ``\n> ``\n  <thinking>MARK</thinking>\n===\n> ``\n', '>> z\n    ``\n> ``\n  \n===\n> ``'],
  [
    '> x\n\t`\n2. item\n> `<thinking>MARK</thinking>\n  `open\n',
    '> x\n\t`\n2. item\n> `<thinking>MARK</thinking>\n  `open'
  ],
  ['> `\n2. item\n--\n> `<analysis>MARK</analysis>`\n', '> `\n2. item\n--\n> `<analysis>MARK</analysis>`'],
  ['> `<thinking>MARK</thinking>\r\n2. item\r\n--\r\n\t`\r\n', '> `\r\n2. item\r\n--\r\n\t`'],
  [
    '> close`\r\n2. item\r\n--\r\n> `<analysis>MARK</analysis>`\r\n',
    '> close`\r\n2. item\r\n--\r\n> `<analysis>MARK</analysis>`'
  ],
  [
    '> x\n  `open\n  `open\n    `<thinking>MARK</thinking>\n2. item\n> quoted `code`\n',
    '> x\n  `open\n  `open\n    `\n2. item\n> quoted `code`'
  ],
  [
    '> > ===\t\n``` a`b\n2. `<analysis>MARK</analysis>`\n>> `<thinking>MARK</thinking>`\n',
    '> > ===\t\n``` a`b\n2. ``\n>> `<thinking>MARK</thinking>`'
  ],
  ['> `<thinking>MARK</thinking>\r\n===\r\n2. item\r\n> close`\r\n', '> `\r\n===\r\n2. item\r\n> close`'],
  [
    '> > inner\n  `open\n> ``\n  `open\n===\n  x `<thinking>MARK</thinking>` y\n',
    '> > inner\n  `open\n> ``\n  `open\n===\n  x `<thinking>MARK</thinking>` y'
  ],
  [
    '>> z\n`<thinking>MARK</thinking>\n> ``\n--\n    `\n``<thinking>MARK</thinking>``\n',
    '>> z\n`\n> ``\n--\n    `\n``<thinking>MARK</thinking>``'
  ],
  [
    '> > inner\nlazy `\n2. item\n> > inner\n`<thinking>MARK</thinking>`\n',
    '> > inner\nlazy `\n2. item\n> > inner\n`<thinking>MARK</thinking>`'
  ],
  ['> x\n\t`\n2. item\n> <assessment>MARK</assessment>\n\t`\n', '> x\n\t`\n2. item\n> \n\t`'],
  ['> x\n  `<thinking>MARK</thinking>\n===\n2. item\n\t`\n', '> x\n  `\n===\n2. item\n\t`'],
  ['> 2. qord\n`<thinking>MARK</thinking>\n1.     `\n> `q tick`\n', '> 2. qord\n`\n1.     `\n> `q tick`'],
  [
    '> x\n    ``\n2. item\n--\n  ``<thinking>MARK</thinking>``\n',
    '> x\n    ``\n2. item\n--\n  ``<thinking>MARK</thinking>``'
  ],
  ['> `<thinking>MARK</thinking>\r\n2. item\r\n===\r\n    `\r\n', '> `\r\n2. item\r\n===\r\n    `'],
  [
    '> x\n    `\n2. item\n> `<thinking>MARK</thinking>\n\t`\n',
    '> x\n    `\n2. item\n> `<thinking>MARK</thinking>\n\t`'
  ],
  ['> close`\n===\n2. item\n`<thinking>MARK</thinking>`\n', '> close`\n===\n2. item\n`<thinking>MARK</thinking>`'],
  [
    '> a `b`\n2. item\n--\nlazy `\n> ``\n    `<thinking>MARK</thinking>\n    ``\n',
    '> a `b`\n2. item\n--\nlazy `\n> ``\n    `<thinking>MARK</thinking>\n    ``'
  ],
  ['> `\n<assessment>MARK</assessment>\n--\n2. item\n> `\n', '> `\n\n--\n2. item\n> `'],
  [
    '>> z\nlazy `\n2. item\n> > inner\n    `<thinking>MARK</thinking>`\n',
    '>> z\nlazy `\n2. item\n> > inner\n    `<thinking>MARK</thinking>`'
  ],
  [
    '> a `b`\n2. item\n  `<thinking>MARK</thinking>\n> <thinking>MARK</thinking>\n===\n\t`\n',
    '> a `b`\n2. item\n  `\n> \n===\n\t`'
  ],
  ['> x\n    `\n2. item\n===\n`<thinking>MARK</thinking>`\n', '> x\n    `\n2. item\n===\n`<thinking>MARK</thinking>`'],
  ['>> z\n    `<thinking>MARK</thinking>\n> > inner\n2. item\n    `\n', '>> z\n    `\n> > inner\n2. item\n    `'],
  [
    '2. item\r\nclose`\r\n=\r\n2. `<thinking>MARK</thinking>`\r\n',
    '2. item\r\nclose`\r\n=\r\n2. `<thinking>MARK</thinking>`'
  ],
  [
    '> x\n    ``\n2. item\n  `<thinking>MARK</thinking>\n> quoted `code`\n',
    '> x\n    ``\n2. item\n  `\n> quoted `code`'
  ],
  ['> ``\n===\n2. item\n``<thinking>MARK</thinking>``\n', '> ``\n===\n2. item\n``<thinking>MARK</thinking>``'],
  ['> x\n\t`\n2. item\n    `\n  `<thinking>MARK</thinking>\n> `\n', '> x\n\t`\n2. item\n    `\n  `\n> `'],
  ['> close`\r\n--\r\n2. item\r\n<thinking>MARK</thinking>\r\n\t`\r\n', '> close`\r\n--\r\n2. item\r\n\r\n\t`'],
  [
    '> > inner\n> `\n> > inner\n\t`\n===\n    `<thinking>MARK</thinking>`\n',
    '> > inner\n> `\n> > inner\n\t`\n===\n    `<thinking>MARK</thinking>`'
  ],
  [
    '> text `t`\nlazy `\n--\n2. item\n    x `<thinking>MARK</thinking>` y\n',
    '> text `t`\nlazy `\n--\n2. item\n    x `<thinking>MARK</thinking>` y'
  ],
  [
    '>> z\n  `open\n> > inner\n    `<thinking>MARK</thinking>`\n> `\n> `<thinking>MARK</thinking>`\n',
    '>> z\n  `open\n> > inner\n    `<thinking>MARK</thinking>`\n> `\n> ``'
  ],
  [
    '> a `b`\n    `\n--\n2. item\n    `<thinking>MARK</thinking>\nlazy `\n',
    '> a `b`\n    `\n--\n2. item\n    `<thinking>MARK</thinking>\nlazy `'
  ],
  [
    '> quoted `code`\r\nlazy `\r\nlazy `\r\n2. item\r\nlazy `\r\n===\r\n> x `<thinking>MARK</thinking>` y\r\n',
    '> quoted `code`\r\nlazy `\r\nlazy `\r\n2. item\r\nlazy `\r\n===\r\n> x `<thinking>MARK</thinking>` y'
  ],
  [
    '>> z\n    `\n> ``\n> close`\n===\n``<thinking>MARK</thinking>``\n',
    '>> z\n    `\n> ``\n> close`\n===\n``<thinking>MARK</thinking>``'
  ],
  ['> x\n    `\n    <assessment>MARK</assessment>\n2. item\n> `\n', '> x\n    `\n    \n2. item\n> `'],
  [
    '> a `b`\n\t`\n2. item\n\t`\n  `open\n--\n  x `<thinking>MARK</thinking>` y\n',
    '> a `b`\n\t`\n2. item\n\t`\n  `open\n--\n  x `<thinking>MARK</thinking>` y'
  ],
  [
    '> 2. qord\n    close`\nclose`\n    `\n2. item\n> x `<thinking>MARK</thinking>` y\n',
    '> 2. qord\n    close`\nclose`\n    `\n2. item\n> x `<thinking>MARK</thinking>` y'
  ],
  ['>> 1. one\n\t```\n2. <thinking>MARK</thinking>\n>> ``` a`b\n', '>> 1. one\n\t```\n2. \n>> ``` a`b'],
  [
    '>>   - nested\r\n``` a`b\r\n``\r\n> > deep2\r\n  ``<thinking>MARK</thinking>``\r\n> `q tick`\r\n',
    '>>   - nested\r\n``` a`b\r\n``\r\n> > deep2\r\n  ``<thinking>MARK</thinking>``\r\n> `q tick`'
  ],
  [
    '> text `t`\n\t`\n--\n2. item\n    `<thinking>MARK</thinking>`\n',
    '> text `t`\n\t`\n--\n2. item\n    `<thinking>MARK</thinking>`'
  ],
  ['> `\n===\n2. item\n    <assessment>MARK</assessment>\nlazy `\n', '> `\n===\n2. item\n    \nlazy `'],
  [
    '>> z\n\t`\n> > nested `d`\n2. item\n    `<analysis>MARK</analysis>`\n',
    '>> z\n\t`\n> > nested `d`\n2. item\n    `<analysis>MARK</analysis>`'
  ],
  ['> text `t`\n===\n2. item\n    `<thinking>MARK</thinking>\n> close`\n', '> text `t`\n===\n2. item\n    `\n> close`'],
  ['> x\n    `\n2. item\n> `<thinking>MARK</thinking>`\n', '> x\n    `\n2. item\n> `<thinking>MARK</thinking>`'],
  ['> x\n\t`\n2. item\n> `<analysis>MARK</analysis>`\n', '> x\n\t`\n2. item\n> `<analysis>MARK</analysis>`'],
  ['> ``\n--\n2. ``<thinking>MARK</thinking>``\n', '> ``\n--\n2. ``<thinking>MARK</thinking>``'],
  [
    '> close`\n--\n2. item\n  x `<thinking>MARK</thinking>` y\n',
    '> close`\n--\n2. item\n  x `<thinking>MARK</thinking>` y'
  ],
  [
    '> > nested `d`\n  `open\n2. item\n===\nx `<thinking>MARK</thinking>` y\n',
    '> > nested `d`\n  `open\n2. item\n===\nx `<thinking>MARK</thinking>` y'
  ],
  [
    '> `\r\n2. item\r\n===\r\n  `<thinking>MARK</thinking>\r\nlazy `\r\n',
    '> `\r\n2. item\r\n===\r\n  `<thinking>MARK</thinking>\r\nlazy `'
  ],
  [
    '>> z\n    `\n> `\n===\n  x `<thinking>MARK</thinking>` y\n',
    '>> z\n    `\n> `\n===\n  x `<thinking>MARK</thinking>` y'
  ],
  [
    '> - qitem\n``` a`b\n2. <thinking>MARK</thinking>\n> <thinking>MARK</thinking>\ntext `tick` more\n',
    '> - qitem\n``` a`b\n2. \n> \ntext `tick` more'
  ],
  [
    '> text `t`\r\n===\r\n2. item\r\nlazy `\r\n> quoted `code`\r\n`<thinking>MARK</thinking>`\r\n',
    '> text `t`\r\n===\r\n2. item\r\nlazy `\r\n> quoted `code`\r\n`<thinking>MARK</thinking>`'
  ],
  [
    '> text `t`\r\n    `\r\n===\r\n2. item\r\n    `<thinking>MARK</thinking>`\r\n',
    '> text `t`\r\n    `\r\n===\r\n2. item\r\n    `<thinking>MARK</thinking>`'
  ],
  ['> x\n    `<thinking>MARK</thinking>\n===\n2. item\n\t`\n', '> x\n    `\n===\n2. item\n\t`'],
  [
    '>> z\n  `open\n> close`\n===\n  `<analysis>MARK</analysis>`\n',
    '>> z\n  `open\n> close`\n===\n  `<analysis>MARK</analysis>`'
  ],
  [
    '- > - qitem\n    `open\n``` a`b\n2. `open\n> x `<thinking>MARK</thinking>` y\n',
    '- > - qitem\n    `open\n``` a`b\n2. `open\n> x `<thinking>MARK</thinking>` y'
  ],
  ['> x\n    `\n2. item\n> `<analysis>MARK</analysis>`\n', '> x\n    `\n2. item\n> `<analysis>MARK</analysis>`'],
  [
    '> x\n    `\n> quoted `code`\n2. item\n    `<analysis>MARK</analysis>`\n',
    '> x\n    `\n> quoted `code`\n2. item\n    `<analysis>MARK</analysis>`'
  ],
  ['> x\n  `<thinking>MARK</thinking>\n2. item\n> `\n', '> x\n  `\n2. item\n> `'],
  [
    '>> z\r\nlazy `\r\nlazy `\r\n    `\r\n> close`\r\n===\r\n> `<analysis>MARK</analysis>`\r\n',
    '>> z\r\nlazy `\r\nlazy `\r\n    `\r\n> close`\r\n===\r\n> `<analysis>MARK</analysis>`'
  ],
  [
    '>> z\n    `\n2. item\n> > nested `d`\n    `<thinking>MARK</thinking>`\n',
    '>> z\n    `\n2. item\n> > nested `d`\n    `<thinking>MARK</thinking>`'
  ],
  [
    '- x\n``` a`b\n===\t\n2. x `<thinking>MARK</thinking>` y\n',
    '- x\n``` a`b\n===\t\n2. x `<thinking>MARK</thinking>` y'
  ],
  ['>> z\n  `open\n> `\n> <assessment>MARK</assessment>\n--\nlazy `\n', '>> z\n  `open\n> `\n> \n--\nlazy `'],
  [
    '> text `t`\n\t`\n===\n2. item\n    `<analysis>MARK</analysis>`\n',
    '> text `t`\n\t`\n===\n2. item\n    `<analysis>MARK</analysis>`'
  ],
  [
    '>> <assessment>MARK</assessment>\n\tclose`\n2. item\n=\n  `<analysis>MARK</analysis>`\n',
    '>> \n\tclose`\n2. item\n=\n  `<analysis>MARK</analysis>`'
  ],
  [
    '2. > > deep2\r\n``\r\n> > ``<thinking>MARK</thinking>``\r\n',
    '2. > > deep2\r\n``\r\n> > ``<thinking>MARK</thinking>``'
  ],
  [
    '> x\r\n    `\r\n2. item\r\n> `<analysis>MARK</analysis>`\r\n',
    '> x\r\n    `\r\n2. item\r\n> `<analysis>MARK</analysis>`'
  ],
  [
    '>> z\n    `\n> close`\n--\nx `<thinking>MARK</thinking>` y\n',
    '>> z\n    `\n> close`\n--\nx `<thinking>MARK</thinking>` y'
  ],
  [
    '> text `t`\n  `open\n--\n2. item\n  `<analysis>MARK</analysis>`\n',
    '> text `t`\n  `open\n--\n2. item\n  `<analysis>MARK</analysis>`'
  ],
  [
    '>> z\r\n  `open\r\n\t`\r\n> quoted `code`\r\n`<thinking>MARK</thinking>\r\n> > nested `d`\r\n  `open\r\n===\r\n  `<thinking>MARK</thinking>`\r\n',
    '>> z\r\n  `open\r\n\t`\r\n> quoted `code`\r\n`\r\n> > nested `d`\r\n  `open\r\n===\r\n  `<thinking>MARK</thinking>`'
  ],
  [
    '> a `b`\n===\n2. item\n\t`\n> `<thinking>MARK</thinking>`\n',
    '> a `b`\n===\n2. item\n\t`\n> `<thinking>MARK</thinking>`'
  ],
  [
    '> close`\r\n`<thinking>MARK</thinking>\r\n  `open\r\n===\r\n2. item\r\n  `<thinking>MARK</thinking>`\r\n',
    '> close`\r\n`\r\n  `open\r\n===\r\n2. item\r\n  `<thinking>MARK</thinking>`'
  ],
  ['>> z\n\t`\n> close`\n===\n> <thinking>MARK</thinking>\n> `\n', '>> z\n\t`\n> close`\n===\n> \n> `'],
  [
    '>> z\n    `\n> > nested `d`\n  `<analysis>MARK</analysis>`\n    `\n    `\n> `\n`<thinking>MARK</thinking>`\n',
    '>> z\n    `\n> > nested `d`\n  `<analysis>MARK</analysis>`\n    `\n    `\n> `\n``'
  ],
  ['> x\r\n`<thinking>MARK</thinking>\r\n2. item\r\n> close`\r\n', '> x\r\n`\r\n2. item\r\n> close`'],
  [
    '> ``\r\n--\r\n2. item\r\n``<thinking>MARK</thinking>``\r\n',
    '> ``\r\n--\r\n2. item\r\n``<thinking>MARK</thinking>``'
  ]
])('leaves excluded mixed-container shapes at the baseline policy: %s', (raw, expected) => {
  expect(stripModelScratchpadBlocks(raw)).toBe(expected)
})

it.each([
  '- `t`\r\n``` a`b\r\n-- \r\n    - deep\r\n`<thinking>MARK</thinking>`\r\n',
  '* item\r\n``` a`b\r\n=\r\n    - deep\r\nx `<thinking>MARK</thinking>` y\r\n'
])('keeps baseline literal code when a nested item follows a setext-like line: %s', (raw) => {
  expect(stripModelScratchpadBlocks(raw)).toContain('MARK')
})

it('keeps baseline inline literal after a second indented underline', () => {
  expect(stripModelScratchpadBlocks('  - `\n  ===\n    ===\n    `<thinking>MARK</thinking>`\n  - \n')).toContain('MARK')
})
