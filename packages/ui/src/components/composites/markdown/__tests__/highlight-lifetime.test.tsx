// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react'
import type { CodeHighlighterPlugin } from 'streamdown'
import { describe, expect, it } from 'vitest'

import { StreamingMarkdown } from '../streaming-markdown'

describe('Streamdown highlight callback lifetime', () => {
  it('shows current raw text and discards late source/theme callbacks and unmounted completions', async () => {
    const pending: { source: string; finish: () => void }[] = []
    const plugin: CodeHighlighterPlugin = {
      name: 'shiki',
      type: 'code-highlighter',
      getSupportedLanguages: () => ['typescript'],
      getThemes: () => ['github-light', 'github-dark'],
      supportsLanguage: () => true,
      highlight({ code }, callback) {
        pending.push({
          source: code,
          finish: () => callback?.({ tokens: [[{ content: code, offset: 0, color: 'red' }]] })
        })
        return null
      }
    }
    const plugins = { code: plugin }
    const view = render(
      <StreamingMarkdown id="lifetime" animated={false} plugins={plugins}>
        {'```typescript\nconst old = 1'}
      </StreamingMarkdown>
    )
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    const stale = [...pending]
    view.rerender(
      <StreamingMarkdown id="lifetime" animated={false} plugins={plugins}>
        {'```typescript\nconst newValue = 2'}
      </StreamingMarkdown>
    )
    await waitFor(() => expect(pending.some((item) => item.source.includes('newValue'))).toBe(true))
    expect(view.container.querySelector('pre code')?.textContent).toContain('newValue')
    await act(async () => {
      pending.filter((item) => item.source.includes('newValue')).forEach((item) => item.finish())
    })
    await act(async () => {
      stale.forEach((item) => item.finish())
    })
    expect(view.container.querySelector('pre code')?.textContent).toContain('newValue')
    expect(view.container.querySelector('pre code')?.textContent).not.toContain('old')
    const darkPlugin = { ...plugin, getThemes: (): ReturnType<CodeHighlighterPlugin['getThemes']> => ['nord', 'nord'] }
    view.rerender(
      <StreamingMarkdown id="lifetime" animated={false} plugins={{ code: darkPlugin }}>
        {'```typescript\nconst final = 3'}
      </StreamingMarkdown>
    )
    await waitFor(() => expect(pending.some((item) => item.source.includes('final'))).toBe(true))
    view.unmount()
    const fresh = render(
      <StreamingMarkdown id="fresh" animated={false} plugins={plugins}>
        {'```typescript\nconst fresh = 4'}
      </StreamingMarkdown>
    )
    await act(async () => {
      pending.filter((item) => !item.source.includes('fresh')).forEach((item) => item.finish())
    })
    expect(fresh.container.querySelector('pre code')?.textContent).toContain('fresh')
    expect(fresh.container.querySelector('pre code')?.textContent).not.toContain('final')
  })
})
