// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../markdown'
import { StreamingMarkdown } from '../streaming-markdown'

const notes = (label: string) => `Read[^1] and again[^1].\n\n[^1]: ${label}`

describe('Markdown footnotes', () => {
  it.each(['static', 'streaming'] as const)(
    'navigates references and backlinks within each %s document',
    async (mode) => {
      const user = userEvent.setup()
      const { container } = render(
        <>
          {mode === 'static' ? (
            <Markdown id="first">{notes('First explanation')}</Markdown>
          ) : (
            <StreamingMarkdown id="first">{notes('First explanation')}</StreamingMarkdown>
          )}
          <Markdown id="second">{notes('Second explanation')}</Markdown>
        </>
      )
      const documents = container.querySelectorAll('.markdown')
      for (const element of container.querySelectorAll<HTMLElement>('[id]')) element.scrollIntoView = () => {}
      for (const [index, document] of [...documents].entries()) {
        const references = document.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]')
        expect(references).toHaveLength(2)
        const ref = references[1]
        ref.focus()
        await user.keyboard('{Enter}')
        const footnote = container.ownerDocument.getElementById(decodeURIComponent(ref.hash.slice(1)))!
        expect(footnote.textContent).toContain(index === 0 ? 'First explanation' : 'Second explanation')
        expect(container.ownerDocument.activeElement).toBe(footnote)
        const backlinks = footnote.querySelectorAll<HTMLAnchorElement>('a[data-footnote-backref]')
        expect(backlinks).toHaveLength(2)
        await user.click(backlinks[1])
        expect(container.ownerDocument.activeElement).toBe(ref)
        const label = container.ownerDocument.getElementById(ref.getAttribute('aria-describedby')!)
        expect(label?.textContent).toBe('Footnotes')
        expect(document.contains(label)).toBe(true)
      }
      const ids = [...container.querySelectorAll('[id]')].map((element) => element.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  )

  it('preserves external-link confirmation beside a footnote', async () => {
    const user = userEvent.setup()
    render(<Markdown id="external">{'[Guide](https://example.com/guide) and note[^1].\n\n[^1]: Explanation'}</Markdown>)
    await user.click(screen.getByRole('button', { name: 'Guide' }))
    expect(screen.getByText('https://example.com/guide')).not.toBeNull()
  })

  it.each(['static', 'streaming'] as const)(
    'refreshes generated footnote content when a %s document changes',
    (mode) => {
      const view = (content: string) =>
        mode === 'static' ? (
          <Markdown id="language">{notes(content)}</Markdown>
        ) : (
          <StreamingMarkdown id="language">{notes(content)}</StreamingMarkdown>
        )
      const { rerender, container } = render(view('English explanation'))
      rerender(view('中文说明'))
      expect(container.querySelector('[data-footnotes]')?.textContent).toContain('中文说明')
      expect(container.querySelector('[data-footnotes]')?.textContent).not.toContain('English explanation')
    }
  )
})
