import { render, screen } from '@testing-library/react'
import type { Element } from 'hast'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: PropsWithChildren) => <span data-testid="svg-context-menu">{children}</span>
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: { show: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import MarkdownSvgRenderer from '../MarkdownSvgRenderer'

const firstNode = { type: 'element', tagName: 'svg', properties: { 'data-source': 'first' }, children: [] } as Element
const katexNode = {
  type: 'element',
  tagName: 'svg',
  properties: {
    xmlns: 'http://www.w3.org/2000/svg',
    width: '400em',
    height: '1.08em',
    viewBox: '0 0 400000 1080',
    preserveAspectRatio: 'xMinYMin slice'
  },
  children: [{ type: 'element', tagName: 'path', properties: { d: 'M95,702' }, children: [] }]
} as Element
const userNode = {
  type: 'element',
  tagName: 'svg',
  properties: { viewBox: '0 0 100 100' },
  children: [{ type: 'element', tagName: 'circle', properties: { cx: '50', cy: '50', r: '40' }, children: [] }]
} as Element
const secondNode = {
  type: 'element',
  tagName: 'svg',
  properties: { 'data-source': 'second' },
  children: []
} as Element

function createRect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }
}

describe('MarkdownSvgRenderer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('remeasures when the renderer receives a different SVG source', () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: SVGElement) {
      return this.getAttribute('aria-label') === 'Second SVG' ? createRect(240, 120) : createRect(120, 60)
    })

    const { rerender } = render(
      <MarkdownSvgRenderer
        node={firstNode}
        data-needs-measurement="true"
        role="img"
        aria-label="First SVG"
        width="10em"
        height="5em"
      />
    )

    expect(screen.getByRole('img', { name: 'First SVG' })).toHaveAttribute('viewBox', '0 0 120 60')

    rerender(
      <MarkdownSvgRenderer
        node={secondNode}
        data-needs-measurement="true"
        role="img"
        aria-label="Second SVG"
        width="10em"
        height="5em"
      />
    )

    expect(screen.getByRole('img', { name: 'Second SVG' })).toHaveAttribute('viewBox', '0 0 240 120')
  })

  it('renders KaTeX-generated SVGs without the context menu wrapper', () => {
    render(<MarkdownSvgRenderer node={katexNode} width="400em" height="1.08em" viewBox="0 0 400000 1080" />)

    expect(screen.queryByTestId('svg-context-menu')).not.toBeInTheDocument()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('keeps the context menu wrapper for user SVGs', () => {
    render(<MarkdownSvgRenderer node={userNode} viewBox="0 0 100 100" />)

    expect(screen.getByTestId('svg-context-menu')).toBeInTheDocument()
  })
})
