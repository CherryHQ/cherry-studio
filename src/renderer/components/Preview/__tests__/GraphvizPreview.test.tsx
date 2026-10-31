import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GraphvizPreview from '../GraphvizPreview'

const mocks = vi.hoisted(() => ({
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as ((content: string, container: HTMLDivElement) => Promise<void>) | undefined
}))

vi.mock('@cherrystudio/ui/mermaid', () => ({
  resolveMermaidTheme: () => ({ roles: { border: '#111111', text: '#222222', line: '#333333' } })
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (
    _content: string,
    renderFunction: (content: string, container: HTMLDivElement) => Promise<void>
  ) => {
    mocks.renderFunction = renderFunction
    return { containerRef: { current: null }, error: null, isLoading: false }
  }
}))

vi.mock('../ImagePreviewLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('../utils', () => ({
  renderSvgInShadowHost: mocks.renderSvgInShadowHost
}))

async function renderDot(content: string): Promise<string> {
  render(<GraphvizPreview>{content}</GraphvizPreview>)
  await mocks.renderFunction?.(content, document.createElement('div'))
  return mocks.renderSvgInShadowHost.mock.lastCall?.[0] as string
}

describe('GraphvizPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderFunction = undefined
  })

  it('draws the diagram in the theme colours on a transparent background', async () => {
    const svg = await renderDot('digraph { a -> b }')

    expect(svg).toContain('<ellipse fill="none" stroke="#111111"')
    expect(svg).toContain('fill="#222222">a</text>')
    expect(svg).toContain('<path fill="none" stroke="#333333"')
    expect(svg).not.toContain('fill="white"')
  })

  it('keeps colours the source sets itself', async () => {
    const svg = await renderDot('digraph { node [color=red]; a -> b [color=green] }')

    expect(svg).toContain('<ellipse fill="none" stroke="red"')
    expect(svg).toContain('<path fill="none" stroke="green"')
  })
})
