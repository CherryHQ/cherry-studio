import { render, screen } from '@testing-library/react'
import type { Element } from 'hast'
import type { PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: { show: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import MarkdownSvgRenderer from '../MarkdownSvgRenderer'

const firstNode = { type: 'element', tagName: 'svg', properties: { 'data-source': 'first' }, children: [] } as Element
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
})
