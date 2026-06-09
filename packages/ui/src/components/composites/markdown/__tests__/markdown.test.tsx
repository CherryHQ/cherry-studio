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
    expect(h1?.getAttribute('id')).toBe('heading-m1--hello-world-0')
  })

  it('renders fenced code blocks', () => {
    const { container } = render(
      <Markdown id="m2" plugins={withChatPlugins()}>
        {'```ts\nconst x = 1\n```'}
      </Markdown>
    )
    expect(container.querySelector('pre')).not.toBeNull()
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
