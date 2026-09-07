import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidPreview from '../MermaidPreview'

type RenderFunction = (content: string, container: HTMLDivElement) => Promise<void>
type RenderOptions = { shouldRender?: () => boolean }

const mocks = vi.hoisted(() => ({
  mermaid: {
    parse: vi.fn(),
    render: vi.fn()
  },
  useMermaid: vi.fn(),
  useDebouncedRender: vi.fn(),
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as RenderFunction | undefined,
  renderOptions: undefined as RenderOptions | undefined,
  containerRef: { current: null as HTMLDivElement | null },
  hookState: {
    error: null as string | null,
    isLoading: false
  },
  observerCallback: undefined as MutationCallback | undefined,
  observer: {
    observe: vi.fn(),
    disconnect: vi.fn(),
    takeRecords: vi.fn()
  },
  imageActions: {
    pan: vi.fn(),
    zoom: vi.fn(),
    copy: vi.fn(),
    download: vi.fn(),
    dialog: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: () => mocks.useMermaid()
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (content: string, renderFunction: RenderFunction, options: RenderOptions) => {
    mocks.useDebouncedRender(content, renderFunction, options)
    mocks.renderFunction = renderFunction
    mocks.renderOptions = options
    return {
      containerRef: mocks.containerRef,
      ...mocks.hookState,
      triggerRender: vi.fn(),
      cancelRender: vi.fn(),
      clearError: vi.fn(),
      setLoading: vi.fn()
    }
  }
}))

vi.mock('../utils', () => ({
  renderSvgInShadowHost: mocks.renderSvgInShadowHost
}))

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: () => mocks.imageActions
}))

vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <div data-testid="loading-indicator" />
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'test-id'
}))

describe('MermaidPreview', () => {
  const content = 'graph TD\nA-->B'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderFunction = undefined
    mocks.renderOptions = undefined
    mocks.containerRef.current = null
    mocks.hookState.error = null
    mocks.hookState.isLoading = false
    mocks.useMermaid.mockReturnValue({
      mermaid: mocks.mermaid,
      isLoading: false,
      error: null,
      forceRenderKey: 0
    })
    mocks.mermaid.parse.mockResolvedValue(true)
    mocks.mermaid.render.mockResolvedValue({
      svg: '<svg><g transform="translate(undefined, NaN)">diagram</g></svg>'
    })

    vi.stubGlobal(
      'MutationObserver',
      vi.fn().mockImplementation((callback: MutationCallback) => {
        mocks.observerCallback = callback
        return mocks.observer
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses and renders Mermaid output into the preview host', async () => {
    render(<MermaidPreview>{content}</MermaidPreview>)
    const container = mocks.containerRef.current!
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    await mocks.renderFunction?.(content, container)

    const measureElement = mocks.mermaid.render.mock.calls[0][2]
    expect(mocks.mermaid.parse).toHaveBeenCalledWith(content)
    expect(mocks.mermaid.render).toHaveBeenCalledWith('mermaid-test-id', content, measureElement)
    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith(
      '<svg><g transform="translate(0, 0)">diagram</g></svg>',
      container
    )
    expect(document.body).not.toContainElement(measureElement)
  })

  it('surfaces Mermaid initialization state ahead of render state', () => {
    mocks.useMermaid.mockReturnValue({
      mermaid: mocks.mermaid,
      isLoading: true,
      error: null,
      forceRenderKey: 0
    })
    const { rerender } = render(<MermaidPreview>{content}</MermaidPreview>)

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()

    mocks.useMermaid.mockReturnValue({
      mermaid: mocks.mermaid,
      isLoading: false,
      error: 'Mermaid initialization failed',
      forceRenderKey: 0
    })
    mocks.hookState.error = 'Diagram rendering failed'
    rerender(<MermaidPreview>{`${content}\nB-->C`}</MermaidPreview>)

    expect(screen.getByText('Mermaid initialization failed')).toBeInTheDocument()
    expect(screen.queryByText('Diagram rendering failed')).not.toBeInTheDocument()
  })

  it('updates the render gate when a folded diagram becomes visible', () => {
    render(<MermaidPreview>{content}</MermaidPreview>)
    const container = mocks.containerRef.current!

    Object.defineProperties(container, {
      offsetParent: { configurable: true, value: null },
      offsetWidth: { configurable: true, value: 0 },
      offsetHeight: { configurable: true, value: 0 }
    })
    act(() => {
      mocks.observerCallback?.([], mocks.observer as unknown as MutationObserver)
    })
    expect(mocks.renderOptions?.shouldRender?.()).toBe(false)

    Object.defineProperties(container, {
      offsetParent: { configurable: true, value: document.body },
      offsetWidth: { configurable: true, value: 640 },
      offsetHeight: { configurable: true, value: 480 }
    })
    act(() => {
      mocks.observerCallback?.([], mocks.observer as unknown as MutationObserver)
    })

    expect(mocks.renderOptions?.shouldRender?.()).toBe(true)
  })
})
