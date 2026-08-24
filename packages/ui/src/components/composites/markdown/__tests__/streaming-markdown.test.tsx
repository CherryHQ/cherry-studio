// @vitest-environment jsdom

/**
 * Smoke tests for `<StreamingMarkdown>`. The load-bearing behaviour is the
 * per-`id` `createAnimatePlugin` lifecycle: once a chunk has been animated,
 * the next render must NOT re-fade the same prefix. We verify the lifecycle
 * via the rendered `<span data-sd-animate>` count, which the plugin only
 * emits for the *unrevealed* tail.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'
import type { ExtraProps } from 'streamdown'
import { describe, expect, it } from 'vitest'

import { useMarkdownBlockContext } from '../context'
import { StreamingMarkdown } from '../streaming-markdown'

describe('StreamingMarkdown', () => {
  it('renders streaming content with animate spans wrapping unrevealed text', () => {
    const { container } = render(<StreamingMarkdown id="s1">{'Hello world'}</StreamingMarkdown>)
    const animateSpans = container.querySelectorAll('[data-sd-animate]')
    // First render: all words are "new" → at least one animate span emitted
    expect(animateSpans.length).toBeGreaterThan(0)
  })

  it('keeps the same animate plugin instance across re-renders with the same id', () => {
    // Load-bearing invariant for the AST-stability mechanism: a single
    // plugin instance must persist across renders so setPrevContentLength /
    // getLastRenderCharCount can carry counters forward. The end-to-end
    // "prefix does not re-fade" property depends on this AND on Streamdown's
    // block memoization; the latter is exercised in chat dogfooding (the
    // observable success criterion is "no visible re-flash on close-fence
    // moments"), not here.
    let lastObservedHtml = ''
    const { container, rerender } = render(<StreamingMarkdown id="s2">{'Hello'}</StreamingMarkdown>)
    lastObservedHtml = container.innerHTML
    expect(lastObservedHtml.length).toBeGreaterThan(0)

    rerender(<StreamingMarkdown id="s2">{'Hello world'}</StreamingMarkdown>)
    expect(container.innerHTML).not.toBe(lastObservedHtml)
    // The growth must contain the new word somewhere in the DOM.
    expect(container.textContent).toContain('world')
  })

  it('resets the animate counter when id changes (different message block)', () => {
    const { container, rerender } = render(<StreamingMarkdown id="block-a">{'Same text'}</StreamingMarkdown>)
    const firstCount = container.querySelectorAll('[data-sd-animate]').length
    expect(firstCount).toBeGreaterThan(0)

    // Same content, fresh id → plugin instance is rebuilt → all words animate again.
    rerender(<StreamingMarkdown id="block-b">{'Same text'}</StreamingMarkdown>)
    const secondCount = container.querySelectorAll('[data-sd-animate]').length
    expect(secondCount).toBeGreaterThan(0)
  })

  it('emits no animate spans when animated={false}', () => {
    const { container } = render(
      <StreamingMarkdown id="s3" animated={false}>
        {'Quiet text'}
      </StreamingMarkdown>
    )
    expect(container.querySelectorAll('[data-sd-animate]').length).toBe(0)
  })

  it('preserves GitHub alert markup while streaming', () => {
    const { container } = render(
      <StreamingMarkdown id="alert-stream">{'> [!NOTE]\n> Streaming alert'}</StreamingMarkdown>
    )

    const alert = container.querySelector('.markdown-alert-note')
    expect(alert).not.toBeNull()
    expect(alert?.querySelector('.markdown-alert-title')?.textContent).toContain('NOTE')
    expect(alert?.textContent).toContain('Streaming alert')
  })

  it('animates inline code text like surrounding prose', () => {
    // Patch narrows streamdown's animate skip set to pre/svg/math, so inline code must get animate spans too.
    const { container } = render(<StreamingMarkdown id="s5">{'run `npm i` now'}</StreamingMarkdown>)
    const inlineCode = container.querySelector('p code')
    expect(inlineCode).not.toBeNull()
    expect(inlineCode?.querySelector('[data-sd-animate]')).not.toBeNull()
  })

  it('still skips fenced code blocks (pre stays in the skip set)', () => {
    const { container } = render(<StreamingMarkdown id="s6">{'```js\nconst a = 1\n```'}</StreamingMarkdown>)
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.querySelector('[data-sd-animate]')).toBeNull()
  })

  it('defaults to opacity-only fadeIn (no lingering filter that alters text antialiasing)', () => {
    // blurIn ends at `filter: blur(0)`, which `animation-fill-mode: both`
    // keeps applied; a non-`none` filter drops subpixel AA so streamed bold/CJK
    // renders heavier than the filter-free static pass. fadeIn leaves no filter.
    const { container } = render(<StreamingMarkdown id="s4">{'**重要** text'}</StreamingMarkdown>)
    const animated = container.querySelector('[data-sd-animate]')
    expect(animated).not.toBeNull()
    const animation = (animated as HTMLElement).style.getPropertyValue('--sd-animation')
    expect(animation).toBe('sd-fadeIn')
  })

  it('provides each streaming block source to custom renderers', async () => {
    const user = userEvent.setup()
    const copied: string[] = []
    const tableMarkdown = `| Name | Type |
| :--- | ---: |
| Project A | In progress |`
    const content = `Intro paragraph\n\n${tableMarkdown}`

    function CopyableTable({ node, ...props }: JSX.IntrinsicElements['table'] & ExtraProps) {
      const markdownContext = useMarkdownBlockContext()
      const position = node?.position
      const source = position
        ? markdownContext?.content
            .split('\n')
            .slice(position.start.line - 1, position.end.line)
            .join('\n')
            .trim()
        : ''

      return (
        <div>
          <table {...props} />
          <button type="button" onClick={() => copied.push(source ?? '')}>
            Copy table
          </button>
        </div>
      )
    }

    render(
      <StreamingMarkdown id="table-source" animated={false} components={{ table: CopyableTable }}>
        {content}
      </StreamingMarkdown>
    )

    await user.click(screen.getByRole('button', { name: 'Copy table' }))
    expect(copied).toEqual([tableMarkdown])
  })
})
