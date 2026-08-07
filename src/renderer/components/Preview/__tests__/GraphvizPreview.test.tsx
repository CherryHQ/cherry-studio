import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GraphvizPreview from '../GraphvizPreview'

const mocks = vi.hoisted(() => ({
  getViz: vi.fn(),
  renderString: vi.fn(),
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as ((content: string, container: HTMLDivElement) => Promise<void>) | undefined
}))

vi.mock('@renderer/utils/asyncInitializer', () => ({
  AsyncInitializer: class {
    constructor() {
      return { get: mocks.getViz }
    }
  }
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (
    _content: string,
    renderFunction: (content: string, container: HTMLDivElement) => Promise<void>
  ) => {
    mocks.renderFunction = renderFunction
    return {
      containerRef: { current: null },
      error: null,
      isLoading: false,
      triggerRender: vi.fn(),
      cancelRender: vi.fn(),
      clearError: vi.fn(),
      setLoading: vi.fn()
    }
  }
}))

vi.mock('../ImagePreviewLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('../utils', () => ({
  renderSvgInShadowHost: mocks.renderSvgInShadowHost
}))

describe('GraphvizPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderFunction = undefined
    mocks.getViz.mockResolvedValue({ renderString: mocks.renderString })
    mocks.renderString.mockReturnValue('<svg><text>diagram</text></svg>')
  })

  it('renders Graphviz output into the preview host', async () => {
    const content = 'digraph { a -> b }'
    const container = document.createElement('div')

    render(<GraphvizPreview>{content}</GraphvizPreview>)
    await mocks.renderFunction?.(content, container)

    expect(mocks.renderString).toHaveBeenCalledWith(content, { format: 'svg' })
    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith('<svg><text>diagram</text></svg>', container)
  })
})
