import { render, renderHook, screen } from '@testing-library/react'
import type { Components } from 'streamdown'
import { describe, expect, it, vi } from 'vitest'

import { scanStandaloneHtmlArtifact } from '@renderer/components/chat/messages/markdown/standaloneHtmlArtifact'
import { updateCodeBlock } from '@renderer/utils/markdown'

import { AppMarkdown } from '../AppMarkdown'
import { useMarkdownCode } from '../useMarkdownCode'

vi.unmock('@cherrystudio/ui')

const Document: NonNullable<Components['code']> = ({ children, className }) => {
  const { text } = useMarkdownCode(children, className)
  return <textarea aria-label="Code document" value={text} readOnly />
}
const components: Partial<Components> = { code: Document }

describe('Markdown code document boundary', () => {
  it.each(['', '\n', '  \n\n'])('keeps raw HTML fast-path source %j exact for saving', (suffix) => {
    const code = '<h1>Hello 中文 🥟</h1>' + suffix
    const markdown = '```html\n' + code + '\n```'
    const artifact = scanStandaloneHtmlArtifact(markdown)!
    const { result } = renderHook(() => useMarkdownCode(artifact.html, 'language-html', 'raw'))
    expect(result.current.text).toBe(code)
    const draft = code + '<!-- draft -->  '
    expect(updateCodeBlock(markdown, result.current.text, draft)).toBe('```html\n' + draft + '\n```')
  })

  it.each(['', '\n', '\n\n', '  \n\n'])(
    'round-trips code with trailing whitespace %j without changing the save echo',
    (suffix) => {
      const code = 'const greeting = "你好 🥟";' + suffix
      const markdown = '```typescript\n' + code + '\n```'
      const host = render(
        <AppMarkdown id="document" components={components}>
          {markdown}
        </AppMarkdown>
      )
      expect(screen.getByRole('textbox', { name: 'Code document' })).toHaveValue(code)
      const draft = code + '// draft  '
      const saved = updateCodeBlock(markdown, code, draft)
      expect(saved).not.toBeNull()
      host.rerender(
        <AppMarkdown id="document" components={components}>
          {saved!}
        </AppMarkdown>
      )
      expect(screen.getByRole('textbox', { name: 'Code document' })).toHaveValue(draft)
    }
  )

  it('keeps an empty fenced document empty', () => {
    render(<AppMarkdown components={components}>{'```text\n```'}</AppMarkdown>)
    expect(screen.getByRole('textbox', { name: 'Code document' })).toHaveValue('')
  })
})
