import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MermaidPreview from '../MermaidPreview'

type RenderFunction = (content: string, container: HTMLDivElement) => Promise<void>
type RenderOptions = { shouldRender?: () => boolean }

const mocks = vi.hoisted(() => ({
  mermaid: {
    parse: vi.fn(),
    render: vi.fn(),
    mermaidAPI: { getConfig: vi.fn() }
  },
  useMermaid: vi.fn(),
  useImageTools: vi.fn(),
  useDebouncedRender: vi.fn(),
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as RenderFunction | undefined,
  renderFunctions: new Map<string, RenderFunction>(),
  renderOptions: undefined as RenderOptions | undefined,
  containerRef: { current: null as HTMLDivElement | null },
  containerRefs: new Map<string, { current: HTMLDivElement | null }>(),
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
    mocks.renderFunctions.set(content, renderFunction)
    mocks.renderOptions = options
    return {
      containerRef: mocks.containerRefs.get(content) ?? mocks.containerRef,
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
  useImageTools: (...args: unknown[]) => {
    mocks.useImageTools(...args)
    return mocks.imageActions
  }
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
    mocks.renderFunctions.clear()
    mocks.renderOptions = undefined
    mocks.containerRef.current = null
    mocks.containerRefs.clear()
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
    mocks.mermaid.mermaidAPI.getConfig.mockReturnValue({ themeVariables: { background: 'white' } })

    vi.stubGlobal(
      'MutationObserver',
      vi.fn().mockImplementation(function MutationObserverMock(callback: MutationCallback) {
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

  it.each([
    ['light', 'white'],
    ['dark', '#333']
  ])('uses the rendered Mermaid %s theme background for the preview', async (_theme, background) => {
    mocks.mermaid.mermaidAPI.getConfig.mockReturnValue({ themeVariables: { background } })
    render(<MermaidPreview>{content}</MermaidPreview>)
    const container = mocks.containerRef.current!
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    await act(async () => {
      await mocks.renderFunction?.(content, container)
    })

    expect(mocks.useImageTools.mock.lastCall?.[1]).toMatchObject({ previewBackgroundColor: background })
  })

  it('uses a diagram theme directive for the SVG preview canvas', async () => {
    const directedContent = '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B'
    let background = 'white'
    mocks.mermaid.mermaidAPI.getConfig.mockImplementation(() => ({ themeVariables: { background } }))
    mocks.mermaid.parse.mockImplementation(async () => {
      background = '#333'
      return true
    })
    mocks.mermaid.render.mockResolvedValue({ svg: '<svg data-theme="dark" />' })

    render(<MermaidPreview>{directedContent}</MermaidPreview>)
    const container = mocks.containerRef.current!
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    await act(async () => {
      await mocks.renderFunction?.(directedContent, container)
    })

    expect(mocks.renderSvgInShadowHost.mock.lastCall?.[0]).toBe('<svg data-theme="dark" />')
    expect(mocks.useImageTools.mock.lastCall?.[1]).toMatchObject({ previewBackgroundColor: '#333' })
  })

  it('keeps each concurrent diagram directive paired with its own SVG canvas', async () => {
    const light = '%%{init: {"theme": "default"}}%%\nflowchart LR\n  A --> B'
    const dark = '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  C --> D'
    const lightRef = { current: null as HTMLDivElement | null }
    const darkRef = { current: null as HTMLDivElement | null }
    mocks.containerRefs.set(light, lightRef)
    mocks.containerRefs.set(dark, darkRef)

    let background = 'white'
    let finishLightParse: ((value: boolean) => void) | undefined
    mocks.mermaid.mermaidAPI.getConfig.mockImplementation(() => ({ themeVariables: { background } }))
    mocks.mermaid.parse.mockImplementation((content: string) => {
      background = content === light ? 'white' : '#333'
      return content === light
        ? new Promise<boolean>((resolve) => {
            finishLightParse = resolve
          })
        : Promise.resolve(true)
    })
    mocks.mermaid.render.mockImplementation(async (_id: string, content: string) => ({
      svg: content === light ? '<svg data-theme="light" />' : '<svg data-theme="dark" />'
    }))

    render(
      <>
        <MermaidPreview>{light}</MermaidPreview>
        <MermaidPreview>{dark}</MermaidPreview>
      </>
    )
    vi.spyOn(lightRef.current!, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)
    vi.spyOn(darkRef.current!, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    await act(async () => {
      const lightRender = mocks.renderFunctions.get(light)!(light, lightRef.current!)
      const darkRender = mocks.renderFunctions.get(dark)!(dark, darkRef.current!)
      await Promise.resolve()
      finishLightParse!(true)
      await Promise.all([lightRender, darkRender])
    })

    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith('<svg data-theme="light" />', lightRef.current)
    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith('<svg data-theme="dark" />', darkRef.current)
    expect(mocks.useImageTools.mock.calls.filter(([ref]) => ref === lightRef).at(-1)?.[1]).toMatchObject({
      previewBackgroundColor: 'white'
    })
    expect(mocks.useImageTools.mock.calls.filter(([ref]) => ref === darkRef).at(-1)?.[1]).toMatchObject({
      previewBackgroundColor: '#333'
    })
  })

  it('keeps the preview background paired with a render that finishes after a theme change', async () => {
    let background = 'white'
    mocks.mermaid.mermaidAPI.getConfig.mockImplementation(() => ({ themeVariables: { background } }))

    const pendingRenders: Array<(result: { svg: string }) => void> = []
    mocks.mermaid.render.mockImplementation(() => new Promise((resolve) => pendingRenders.push(resolve)))

    const { rerender } = render(<MermaidPreview>{content}</MermaidPreview>)
    const container = mocks.containerRef.current!
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    let lightRender: Promise<void>
    await act(async () => {
      lightRender = mocks.renderFunction!(content, container)
      await Promise.resolve()
    })

    background = '#333'
    mocks.useMermaid.mockReturnValue({
      mermaid: mocks.mermaid,
      isLoading: false,
      error: null,
      forceRenderKey: 1
    })
    rerender(<MermaidPreview>{content}</MermaidPreview>)

    let darkRender: Promise<void>
    await act(async () => {
      darkRender = mocks.renderFunction!(content, container)
      pendingRenders[0]({ svg: '<svg data-theme="light" />' })
      await lightRender
    })

    expect(mocks.renderSvgInShadowHost.mock.lastCall?.[0]).toBe('<svg data-theme="light" />')
    expect(mocks.useImageTools.mock.lastCall?.[1]).toMatchObject({ previewBackgroundColor: 'white' })

    await act(async () => {
      pendingRenders[1]({ svg: '<svg data-theme="dark" />' })
      await darkRender
    })

    expect(mocks.renderSvgInShadowHost.mock.lastCall?.[0]).toBe('<svg data-theme="dark" />')
    expect(mocks.useImageTools.mock.lastCall?.[1]).toMatchObject({ previewBackgroundColor: '#333' })
  })

  it('rejects a failed render without blocking the next diagram', async () => {
    mocks.mermaid.parse.mockRejectedValueOnce(new Error('invalid diagram'))
    render(<MermaidPreview>{content}</MermaidPreview>)
    const container = mocks.containerRef.current!
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)

    await expect(mocks.renderFunction!(content, container)).rejects.toThrow('invalid diagram')

    await act(async () => {
      await mocks.renderFunction!(content, container)
    })

    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith(
      '<svg><g transform="translate(0, 0)">diagram</g></svg>',
      container
    )
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
      mocks.observerCallback?.([], mocks.observer)
    })
    expect(mocks.renderOptions?.shouldRender?.()).toBe(false)

    Object.defineProperties(container, {
      offsetParent: { configurable: true, value: document.body },
      offsetWidth: { configurable: true, value: 640 },
      offsetHeight: { configurable: true, value: 480 }
    })
    act(() => {
      mocks.observerCallback?.([], mocks.observer)
    })

    expect(mocks.renderOptions?.shouldRender?.()).toBe(true)
  })
})
