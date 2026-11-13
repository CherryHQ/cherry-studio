import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidPreview from '../MermaidPreview'

type RenderFunction = (content: string, container: HTMLDivElement) => Promise<void>

const mocks = vi.hoisted(() => ({
  renderMermaidSvg: vi.fn(),
  resolveMermaidTheme: vi.fn(),
  renderFunction: undefined as RenderFunction | undefined,
  containerRef: { current: null as HTMLDivElement | null }
}))

vi.mock('@cherrystudio/ui/mermaid', () => ({
  resolveMermaidTheme: mocks.resolveMermaidTheme
}))

vi.mock('@renderer/services/MermaidRenderService', () => ({
  mermaidRenderService: { render: mocks.renderMermaidSvg }
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (_content: string, renderFunction: RenderFunction) => {
    mocks.renderFunction = renderFunction
    return { containerRef: mocks.containerRef, error: null, isLoading: false }
  }
}))

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: () => ({ pan: vi.fn(), zoom: vi.fn(), copy: vi.fn(), download: vi.fn(), dialog: vi.fn() })
}))

const svg = (label: string, viewBox = '0 0 200 80') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><text>${label}</text></svg>`
const mounted = () => mocks.containerRef.current?.shadowRoot?.querySelector('svg')

describe('MermaidPreview', () => {
  const theme = { appearance: 'dark', roles: {}, seriesPalette: [], fontFamily: 'Inter', fontSize: '14px' }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.containerRef.current = null
    mocks.resolveMermaidTheme.mockReturnValue(theme)
  })

  it('mounts the diagram Merman renders, themed from the preview’s own surface', async () => {
    mocks.renderMermaidSvg.mockResolvedValue(svg('A to B'))
    render(<MermaidPreview>{'flowchart LR\nA-->B'}</MermaidPreview>)
    const container = mocks.containerRef.current!

    await mocks.renderFunction?.('flowchart LR\nA-->B', container)

    expect(mocks.resolveMermaidTheme).toHaveBeenCalledWith(container)
    expect(mocks.renderMermaidSvg).toHaveBeenCalledWith(
      'flowchart LR\nA-->B',
      expect.objectContaining({ theme, diagramId: expect.stringMatching(/^mermaid-/) })
    )
    expect(mounted()).toHaveTextContent('A to B')
  })

  it('never enlarges a contained diagram past its own height', async () => {
    mocks.renderMermaidSvg.mockResolvedValue(svg('small', '0 0 200 80'))
    render(<MermaidPreview fit="contain">{'flowchart LR\nA-->B'}</MermaidPreview>)

    await mocks.renderFunction?.('flowchart LR\nA-->B', mocks.containerRef.current!)

    expect(mounted()?.style.maxHeight).toBe('80px')
  })

  it('keeps the last good diagram when a newer source fails to render', async () => {
    mocks.renderMermaidSvg.mockResolvedValueOnce(svg('first')).mockRejectedValueOnce(new Error('parse error'))
    render(<MermaidPreview>{'flowchart LR\nA-->B'}</MermaidPreview>)
    const container = mocks.containerRef.current!

    await mocks.renderFunction?.('flowchart LR\nA-->B', container)
    await expect(mocks.renderFunction?.('flowchart LR\nA-->', container)).rejects.toThrow('parse error')

    expect(mounted()).toHaveTextContent('first')
  })
})
