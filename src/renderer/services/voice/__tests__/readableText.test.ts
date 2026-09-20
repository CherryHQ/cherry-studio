import { describe, expect, it } from 'vitest'

import {
  READABLE_TEXT_CHUNK_LIMIT,
  READABLE_TEXT_CONFIRMATION_THRESHOLD,
  SPEECH_ADAPTER_TEXT_LIMIT,
  chunkReadableText,
  normalizeReadableText,
  planReadableText
} from '../readableText'

const privateContainerCases = [
  ['tool call', '<tool-call>', '</tool-call>'],
  ['thinking', '<think>', '</think>'],
  ['reasoning', '<reasoning>', '</reasoning>'],
  ['terminal output', '<terminal-output>', '</terminal-output>'],
  ['approval prompt', '<approval-prompt>', '</approval-prompt>'],
  ['metadata', '<metadata>', '</metadata>'],
  ['voice-hidden data', '<section data-voice-skip>', '</section>']
] as const

describe('normalizeReadableText', () => {
  it('keeps prose structures in reading order while removing Markdown-only syntax', () => {
    const markdown = `# Release notes

Read [Cherry Studio](https://example.com/private-path) today. ![Architecture diagram](/private/file.png)

- First item
- Second item

| Name | Status |
| --- | --- |
| Voice | Ready |`

    expect(normalizeReadableText(markdown)).toBe(
      'Release notes\n\nRead Cherry Studio today. Architecture diagram\n\nFirst item\nSecond item\n\nName Status\nVoice Ready'
    )
  })

  it('omits code, math, private execution content, metadata, and citation markers', () => {
    const markdown = `Visible **answer** [cite:source-1].

\`inlineSecret()\` \\(hidden_math\\)

\`\`\`ts
const secret = 'never read'
\`\`\`

<tool-call>private tool arguments</tool-call>

<terminal-output>private terminal output</terminal-output>

<approval-prompt>private approval prompt</approval-prompt>

<think>private reasoning</think>

<attachment-metadata>private/path.pdf</attachment-metadata>

<div data-voice-skip>private structured metadata</div>

Final sentence.`

    expect(normalizeReadableText(markdown)).toBe('Visible answer.\n\nFinal sentence.')
  })

  it.each(privateContainerCases)(
    'does not leak Markdown across blank lines inside a %s container',
    (_label, open, close) => {
      const markdown = `Before.

${open}

# Private heading

- private **Markdown**
- [private link](https://example.com/private)

${close}

After.`

      expect(normalizeReadableText(markdown)).toBe('Before.\n\nAfter.')
    }
  )

  it('removes chained and padded citation markers emitted through raw HTML without damaging punctuation', () => {
    const markdown = '<p>First [cite:raw-1][cite: raw-2 ], second[cite:raw-3]!</p>'

    expect(normalizeReadableText(markdown)).toBe('First, second!')
  })

  it('reads only meaningful image alt text', () => {
    expect(
      normalizeReadableText(
        'Before ![image](secret.png) ![diagram.png](secret.png) ![System diagram](secret.png) after.'
      )
    ).toBe('Before System diagram after.')
  })

  it('applies meaningful-alt filtering to reference images', () => {
    const markdown = `![Architecture overview][architecture] ![image][generic] ![diagram.png][filename]

[architecture]: https://example.com/architecture.png
[generic]: https://example.com/generic.png
[filename]: https://example.com/filename.png`

    expect(normalizeReadableText(markdown)).toBe('Architecture overview')
  })

  it('normalizes Unicode and natural whitespace without flattening paragraphs', () => {
    expect(normalizeReadableText('Cafe\u0301\u00a0 \tvoice.\r\n\r\n\r\nNext   line.')).toBe('Café voice.\n\nNext line.')
  })

  it('treats an explicit selection as plain text so selected code and math remain readable', () => {
    const selection = '  `const  answer = 42`\r\n\r\n$x^2$  '

    expect(normalizeReadableText(selection, { mode: 'selection' })).toBe('`const answer = 42`\n\n$x^2$')
  })

  it('removes internal citation markers from an explicit selection without removing selected code or math', () => {
    const selection = '`answer()` [cite:source-1][cite: source-2 ] $x^2$'

    expect(normalizeReadableText(selection, { mode: 'selection' })).toBe('`answer()` $x^2$')
  })
})

describe('chunkReadableText', () => {
  it('prefers paragraph boundaries and never exceeds the requested limit', () => {
    const text = 'First paragraph has enough words.\n\nSecond paragraph also has words.\n\nThird paragraph is last.'

    const chunks = chunkReadableText(text, 40)

    expect(chunks).toEqual([
      'First paragraph has enough words.',
      'Second paragraph also has words.',
      'Third paragraph is last.'
    ])
    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true)
  })

  it('hard-splits text with no natural boundary without breaking surrogate pairs', () => {
    const input = '🍒'.repeat(8)
    const chunks = chunkReadableText(input, 5)

    expect(chunks.join('')).toBe(input)
    expect(chunks.every((chunk) => chunk.length <= 5)).toBe(true)
    expect(chunks.every((chunk) => !chunk.includes('\ufffd'))).toBe(true)
  })

  it('prefers CJK sentence punctuation even when no whitespace follows it', () => {
    expect(chunkReadableText('甲句。乙句！丙句？丁句；尾句。', 4)).toEqual([
      '甲句。',
      '乙句！',
      '丙句？',
      '丁句；',
      '尾句。'
    ])
  })

  it('caps caller-supplied limits at the speech adapter maximum', () => {
    const chunks = chunkReadableText('x'.repeat(SPEECH_ADAPTER_TEXT_LIMIT + 1), Number.MAX_SAFE_INTEGER)

    expect(chunks.map((chunk) => chunk.length)).toEqual([SPEECH_ADAPTER_TEXT_LIMIT, 1])
  })
})

describe('planReadableText', () => {
  it('exports distinct confirmation and adapter limits with a product-safe chunk size', () => {
    expect(READABLE_TEXT_CONFIRMATION_THRESHOLD).toBe(5_000)
    expect(SPEECH_ADAPTER_TEXT_LIMIT).toBe(10_000)
    expect(READABLE_TEXT_CHUNK_LIMIT).toBeLessThanOrEqual(SPEECH_ADAPTER_TEXT_LIMIT)
  })

  it('returns ready chunks for text at the confirmation threshold', () => {
    const result = planReadableText('x'.repeat(READABLE_TEXT_CONFIRMATION_THRESHOLD), { trigger: 'manual' })

    expect(result.status).toBe('ready')
    expect(result.normalizedLength).toBe(READABLE_TEXT_CONFIRMATION_THRESHOLD)
    expect(result.chunks.join('')).toBe('x'.repeat(READABLE_TEXT_CONFIRMATION_THRESHOLD))
    expect(result.chunks.every((chunk) => chunk.length <= READABLE_TEXT_CHUNK_LIMIT)).toBe(true)
  })

  it('requires confirmation for a manual read over the threshold without treating it as a hard maximum', () => {
    const input = 'x'.repeat(READABLE_TEXT_CONFIRMATION_THRESHOLD + 1)

    expect(planReadableText(input, { trigger: 'manual' })).toEqual({
      status: 'confirmation_required',
      normalizedLength: input.length,
      chunks: []
    })

    const confirmed = planReadableText(input, { trigger: 'manual', confirmed: true })
    expect(confirmed.status).toBe('ready')
    expect(confirmed.normalizedLength).toBe(input.length)
    expect(confirmed.chunks.join('')).toBe(input)
  })

  it('skips an automatic read over the threshold with a stable reason', () => {
    const input = 'x'.repeat(READABLE_TEXT_CONFIRMATION_THRESHOLD + 1)

    expect(planReadableText(input, { trigger: 'auto_read' })).toEqual({
      status: 'skipped',
      reason: 'too_long',
      normalizedLength: input.length,
      chunks: []
    })
  })
})
