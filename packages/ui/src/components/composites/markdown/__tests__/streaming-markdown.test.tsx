// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'
import type { ExtraProps } from 'streamdown'
import { describe, expect, it } from 'vitest'

import { useMarkdownBlockContext } from '../context'
import { StreamingMarkdown } from '../streaming-markdown'

describe('StreamingMarkdown', () => {
  it.each(['initial', 'appended'] as const)('does not delay received words in a long %s paragraph', (arrival) => {
    const prefix = 'Opening paragraph.\n\n'
    const content = `${prefix}${'received '.repeat(120)}middle-marker\n\nlater-marker`
    const view = render(<StreamingMarkdown id="burst">{arrival === 'initial' ? content : prefix}</StreamingMarkdown>)
    if (arrival === 'appended') {
      view.rerender(<StreamingMarkdown id="burst">{content}</StreamingMarkdown>)
    }

    // The vendor CSS uses this delay with backwards fill, hiding received words until it expires.
    for (const marker of ['middle-marker', 'later-marker']) {
      const element = screen.getByText(marker)
      expect(Number.parseFloat(element.style.getPropertyValue('--sd-delay') || '0')).toBe(0)
    }
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

  it('reuses memoized blocks when content grows but plugin values are unchanged', () => {
    // Catches: new-but-equal remark/rehype/components identities on each
    // streaming tick forcing Streamdown to re-parse every settled block
    // (JSON.stringify cache key + rehype walk) and freeze the renderer.
    const rendered: string[] = []
    function CountingParagraph({ children }: JSX.IntrinsicElements['p'] & ExtraProps) {
      rendered.push(String(children))
      return <p>{children}</p>
    }
    const remarkNoop = () => {}
    const rehypeNoop = () => {}
    const first = 'First paragraph\n\nSecond paragraph'
    const { rerender } = render(
      <StreamingMarkdown
        id="stable-blocks"
        animated={false}
        components={{ p: CountingParagraph }}
        remarkPlugins={[remarkNoop]}
        rehypePlugins={[rehypeNoop]}>
        {first}
      </StreamingMarkdown>
    )
    expect(rendered).toEqual(['First paragraph', 'Second paragraph'])
    rendered.length = 0
    rerender(
      <StreamingMarkdown
        id="stable-blocks"
        animated={false}
        components={{ p: CountingParagraph }}
        remarkPlugins={[remarkNoop]}
        rehypePlugins={[rehypeNoop]}>
        {`${first}\n\nThird paragraph`}
      </StreamingMarkdown>
    )
    expect(rendered).toEqual(['Third paragraph'])
  })
})
