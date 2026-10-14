// @vitest-environment jsdom

/**
 * Smoke tests for the static `<Markdown>` component. Confirms the rehype
 * pipeline composes correctly (headings get the prefixed id, sanitize lets
 * `<sup data-citation>` through, code blocks render).
 */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../markdown'
import { withChatPlugins, withFullMarkdown } from '../presets'

describe('Markdown (static)', () => {
  it('renders a heading with the prefixed id', () => {
    const { container } = render(<Markdown id="m1">{'# Hello World'}</Markdown>)
    const h1 = container.querySelector('h1')
    expect(h1).not.toBeNull()
    expect(h1?.getAttribute('id')).toBe('heading-m1--hello-world')
  })

  it('dedupes duplicate heading ids and falls back after normalization', () => {
    const { container } = render(<Markdown id="m1">{'# Hello World\n\n# Hello World\n\n# !!!'}</Markdown>)
    const headings = Array.from(container.querySelectorAll('h1')).map((heading) => heading.getAttribute('id'))
    expect(headings).toEqual(['heading-m1--hello-world', 'heading-m1--hello-world-1', 'heading-m1--section'])
  })

  it('preserves an id-only HTML anchor as an in-page target', () => {
    const { container } = render(
      <Markdown id="custom-anchor">{'[Jump](#custom-anchor)\n\n<a id="custom-anchor"></a>Target'}</Markdown>
    )

    expect(container.querySelector('#user-content-custom-anchor')).not.toBeNull()
  })

  it('renders fenced code blocks', () => {
    const { container } = render(
      <Markdown id="m2" plugins={withChatPlugins()}>
        {'```ts\nconst x = 1\n```'}
      </Markdown>
    )
    expect(container.querySelector('pre')).not.toBeNull()
  })

  it('keeps single tildes literal while retaining double-tilde strikethrough', () => {
    const { container } = render(
      <Markdown id="tilde-markdown" plugins={withChatPlugins()}>
        {'~literal~ and ~~deleted~~\n\n`~inline~`\n\n```text\n~fenced~\n```\n\n$$\n\\tilde{x}\n$$'}
      </Markdown>
    )

    expect(container.textContent).toContain('~literal~ and deleted')
    expect(container.querySelectorAll('del')).toHaveLength(1)
    expect(container.querySelector('del')?.textContent).toBe('deleted')
    expect(container.querySelector('code')?.textContent).toBe('~inline~')
    expect(container.querySelector('pre code')?.textContent).toBe('~fenced~')
    expect(container.querySelector('math')).not.toBeNull()
  })

  it('renders all GitHub alert types with their semantic classes', () => {
    const alertTypes = ['note', 'tip', 'important', 'warning', 'caution']
    const source = alertTypes.map((type) => `> [!${type.toUpperCase()}]\n> ${type} content`).join('\n\n')
    const { container } = render(<Markdown id="alerts">{source}</Markdown>)

    const alerts = container.querySelectorAll('.markdown-alert')
    expect(alerts).toHaveLength(alertTypes.length)

    alertTypes.forEach((type, index) => {
      expect(alerts[index].classList.contains(`markdown-alert-${type}`)).toBe(true)
      expect(alerts[index].querySelector('.markdown-alert-title')?.textContent).toContain(type.toUpperCase())
      expect(alerts[index].querySelector('svg.octicon')?.getAttribute('aria-hidden')).toBe('true')
      expect(alerts[index].textContent).toContain(`${type} content`)
    })
  })

  it('renders highlight syntax and definition lists used by Markdown previews', () => {
    const { container } = render(<Markdown id="extended-markdown">{'==Important==\n\nTerm\n: Definition'}</Markdown>)

    expect(container.querySelector('mark')?.textContent).toBe('Important')
    expect(container.querySelector('dl')).not.toBeNull()
    expect(container.querySelector('dt')?.textContent).toBe('Term')
    expect(container.querySelector('dd')?.textContent?.trim()).toBe('Definition')
  })

  it('renders single-dollar inline math when the full preview preset enables it', () => {
    const { container } = render(
      <Markdown id="inline-math" plugins={withFullMarkdown({ singleDollarMath: true })}>
        {'Inline: $a^2 + b^2 = c^2$'}
      </Markdown>
    )

    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.textContent).not.toContain('$a^2 + b^2 = c^2$')
  })

  it('keeps generated SVG max-width through the full sanitize pipeline', () => {
    const { container } = render(
      <Markdown id="m3">{'<svg width="120" height="60"><rect width="120" height="60" /></svg>'}</Markdown>
    )
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('viewBox')).toBe('0 0 120 60')
    expect(svg?.getAttribute('width')).toBe('100%')
    expect(svg?.getAttribute('style')).toContain('max-width: 120px')
    expect(svg?.hasAttribute('height')).toBe(false)
  })

  it('does not preserve injected SVG width declarations as style', () => {
    const { container } = render(
      <Markdown id="m3">
        {'<svg width="9px; background: url(https://attacker.example/leak)" height="9"><rect /></svg>'}
      </Markdown>
    )
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('style')).toBeNull()
    expect(container.innerHTML).not.toContain('background')
    expect(container.innerHTML).not.toContain('attacker.example')
  })

  it('passes an opaque citation id through to the sup component', () => {
    let received: string | undefined
    render(
      <Markdown
        id="m5"
        plugins={withChatPlugins()}
        components={{
          sup: (props) => {
            received = (props as { 'data-citation'?: string })['data-citation']
            return <sup />
          }
        }}>
        {`Fact. <sup data-citation="1">1</sup>`}
      </Markdown>
    )
    expect(received).toBe('1')
  })

  it('does not pass forged citation JSON through to the sup component', () => {
    let received: string | undefined
    render(
      <Markdown
        id="m6"
        plugins={withChatPlugins()}
        components={{
          sup: (props) => {
            received = (props as { 'data-citation'?: string })['data-citation']
            return <sup />
          }
        }}>
        {`Fact. <sup data-citation='{&quot;url&quot;:&quot;https://attacker.example&quot;}'>1</sup>`}
      </Markdown>
    )
    expect(received).toBeUndefined()
  })

  it('keeps the text of a link whose protocol sanitize rejects', () => {
    const { container } = render(<Markdown id="m7">{'[Download deck](sandbox:/mnt/data/deck.pptx)'}</Markdown>)

    expect(container.textContent).toBe('Download deck')
    expect(container.innerHTML).not.toContain('blocked')
    // Not linkable: the rejected protocol must not survive as a clickable href.
    expect(container.querySelector('a[href]')).toBeNull()
    expect(container.innerHTML).not.toContain('sandbox:')
  })

  it('keeps an href-less anchor from defacing the surrounding text', () => {
    const { container } = render(<Markdown id="m8">{'Before <a role="toc_link" id="id201"></a> after'}</Markdown>)

    expect(container.textContent).toBe('Before  after')
    expect(container.innerHTML).not.toContain('blocked')
  })

  it('falls back to alt text for an image whose protocol sanitize rejects', () => {
    const { container } = render(
      <Markdown id="m10">{'![Sales chart](sandbox:/mnt/data/chart.png)\n\n![f](file:///x/a.png)'}</Markdown>
    )

    expect(container.textContent).toBe('Sales chart\nf')
    expect(container.innerHTML).not.toContain('blocked')
    // Not loadable: the rejected protocol must not survive as a real image source.
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('sandbox:')
    expect(container.innerHTML).not.toContain('file://')
  })

  it('drops an unrenderable image that has no alt text', () => {
    const { container } = render(<Markdown id="m11">{'![](sandbox:/x.png)'}</Markdown>)

    expect(container.textContent).toBe('')
    expect(container.innerHTML).not.toContain('blocked')
    expect(container.querySelector('img')).toBeNull()
  })

  it('drops javascript: hrefs and script elements', () => {
    const { container } = render(
      <Markdown id="m9">{'[click](javascript:alert(1))\n\n<script>alert(2)</script>'}</Markdown>
    )

    expect(container.querySelector('a[href]')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('alert(2)')
  })

  it('preserves file hrefs without bypassing hardening for other links and images', () => {
    const { container } = render(
      <Markdown
        id="file-links"
        preserveFileLinkHrefs
        components={{
          a: ({ children, href }) => <a href={href}>{children}</a>
        }}>
        {
          '[Relative](./docs/guide.md)\n\n[Windows](C:/Users/Alice/README.md)\n\n[CDN](//cdn.example.com/page)\n\n![CDN image](//cdn.example.com/image.png)\n\n[Unsafe](javascript:alert(1))\n\n<span data-markdown-file-href="javascript:alert(2)">Forged</span>'
        }
      </Markdown>
    )

    const links = container.querySelectorAll('a')
    expect(links).toHaveLength(3)
    expect(links[0].getAttribute('href')).toBe('./docs/guide.md')
    expect(links[1].getAttribute('href')).toBe('C:/Users/Alice/README.md')
    expect(links[2].getAttribute('href')).toBe('https://cdn.example.com/page')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/image.png')
  })

  it('does not preserve a control-character-obfuscated external href as a file link', () => {
    const obfuscatedHref = '\u0001//attacker.example/path'
    const { container } = render(
      <Markdown
        id="obfuscated-external-link"
        preserveFileLinkHrefs
        components={{
          a: ({ children, href }) => <a href={href}>{children}</a>
        }}>
        {`<a href="${obfuscatedHref}">External</a>`}
      </Markdown>
    )

    expect(container.textContent).toContain('External')
    expect(container.querySelector('a[href]')).toBeNull()
    expect(container.innerHTML).not.toContain('attacker.example')
  })

  it('forwards an extra rehype plugin', () => {
    let visited = 0
    const counterPlugin = () => (tree: { children: unknown[] }) => {
      if (Array.isArray(tree.children)) visited = tree.children.length
    }
    render(
      <Markdown id="m4" rehypePlugins={[counterPlugin as unknown as never]}>
        {'A\n\nB\n\nC'}
      </Markdown>
    )
    expect(visited).toBeGreaterThan(0)
  })
})
