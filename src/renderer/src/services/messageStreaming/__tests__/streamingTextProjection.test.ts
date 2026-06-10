import { describe, expect, it } from 'vitest'

import { createStreamingTextProjection } from '../streamingTextProjection'

const formatProgress = ({
  language,
  lineCount,
  charCount
}: {
  language: string
  lineCount: number
  charCount: number
}) => `Generating ${language} · ${lineCount.toLocaleString()} lines · ${charCount.toLocaleString()} chars`

describe('createStreamingTextProjection', () => {
  it('keeps text without fenced code unchanged', () => {
    const content = 'hello\nworld'

    expect(createStreamingTextProjection(content, formatProgress)).toBe(content)
  })

  it('replaces fenced code content with a lightweight placeholder', () => {
    const content = ['Before', '```html', '<html><body>large streaming artifact</body></html>', '```', 'After'].join(
      '\n'
    )

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toContain('Before')
    expect(projected).toContain('After')
    expect(projected).toContain('Generating html · 1 lines · 51 chars')
    expect(projected).not.toContain('large streaming artifact')
    expect(projected).not.toContain('```html')
  })

  it('replaces open fenced code content until the stream completes', () => {
    const content = ['Before', '```tsx', 'const value = "still streaming"'].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toBe(['Before', 'Generating tsx · 1 lines · 31 chars'].join('\n'))
    expect(projected).not.toContain('still streaming')
  })

  it('handles multiple fenced code blocks', () => {
    const content = ['A', '```ts', 'const first = 1', '```', 'B', '~~~html', '<div>second</div>', '~~~', 'C'].join('\n')

    const projected = createStreamingTextProjection(content, formatProgress)

    expect(projected).toBe(
      ['A', 'Generating ts · 1 lines · 16 chars', 'B', 'Generating html · 1 lines · 18 chars', 'C'].join('\n')
    )
    expect(projected).not.toContain('const first')
    expect(projected).not.toContain('<div>second</div>')
  })

  it('falls back to code label when fenced code has no language', () => {
    const content = ['```', 'plain text', '```'].join('\n')

    expect(createStreamingTextProjection(content, formatProgress)).toBe('Generating code · 1 lines · 11 chars')
  })
})
