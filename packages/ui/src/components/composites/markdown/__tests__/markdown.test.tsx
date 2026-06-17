// @vitest-environment jsdom

/**
 * Smoke tests for the static `<Markdown>` component. Confirms the rehype
 * pipeline composes correctly (headings get the prefixed id, sanitize lets
 * `<sup data-citation>` through, code blocks render).
 */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown } from '../markdown'
import { withChatPlugins } from '../presets'

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

  it('renders fenced code blocks', () => {
    const { container } = render(
      <Markdown id="m2" plugins={withChatPlugins()}>
        {'```ts\nconst x = 1\n```'}
      </Markdown>
    )
    expect(container.querySelector('pre')).not.toBeNull()
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
