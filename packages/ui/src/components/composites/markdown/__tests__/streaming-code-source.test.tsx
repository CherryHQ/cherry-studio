// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import type { ExtraProps } from 'streamdown'
import { describe, expect, it } from 'vitest'

import { StreamingMarkdown } from '../streaming-markdown'

function Code({ children }: JSX.IntrinsicElements['code'] & ExtraProps) {
  return (
    <code role="region" aria-label="Source">
      {children}
    </code>
  )
}

describe('streaming code source', () => {
  it.each(['```', '~~~', '````', '~~~~'])(
    'preserves incomplete %s fence content instead of repairing Markdown inside code',
    (fence) => {
      const { rerender } = render(
        <StreamingMarkdown id="source" components={{ code: Code }}>{`${fence}html\nvalue`}</StreamingMarkdown>
      )
      for (const source of ['body {', '~~literal', '<div', '`literal', '*literal', '[text](https://', 'value ']) {
        rerender(
          <StreamingMarkdown id="source" components={{ code: Code }}>{`${fence}html\n${source}`}</StreamingMarkdown>
        )
        expect(screen.getByRole('region', { name: 'Source' }).textContent).toBe(`${source}\n`)
      }
    }
  )

  it('preserves fences in containers while still completing surrounding prose', () => {
    const source = '> ~~~text\n> ~~literal\n> ~~~\n\n**bold'
    render(
      <StreamingMarkdown id="nested" components={{ code: Code, strong: ({ children }) => <strong>{children}</strong> }}>
        {source}
      </StreamingMarkdown>
    )
    expect(screen.getByRole('region', { name: 'Source' }).textContent).toBe('~~literal\n')
    expect(screen.getByText('bold').closest('strong')).not.toBeNull()
  })
})
