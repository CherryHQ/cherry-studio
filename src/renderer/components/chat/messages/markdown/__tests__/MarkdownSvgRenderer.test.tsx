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

describe('chat MarkdownSvgRenderer', () => {
  afterEach(() => vi.restoreAllMocks())

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
