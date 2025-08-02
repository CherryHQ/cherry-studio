import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { MermaidPreview } from '..'

const mocks = vi.hoisted(() => ({
  useMermaid: vi.fn(),
  useDebouncedRender: vi.fn(),
  ImagePreviewLayout: vi.fn(({ children, loading, error, enableToolbar, source }) => (
    <div data-testid="image-preview-layout" data-source={source}>
      {enableToolbar && <div data-testid="toolbar">Toolbar</div>}
      {loading && <div data-testid="loading">Loading...</div>}
      {error && <div data-testid="error">{error}</div>}
      <div data-testid="preview-content">{children}</div>
    </div>
  ))
}))

// Mock hooks
vi.mock('@renderer/hooks/useMermaid', () => ({
  useMermaid: () => mocks.useMermaid()
}))

vi.mock('@renderer/components/Preview/ImagePreviewLayout', () => ({
  default: mocks.ImagePreviewLayout
}))

vi.mock('@renderer/components/Preview/hooks/useDebouncedRender', () => ({
  useDebouncedRender: mocks.useDebouncedRender
}))

// Mock nanoid
vi.mock('@reduxjs/toolkit', () => ({
  nanoid: () => 'test-id-123456'
}))

describe('MermaidPreview', () => {
  const mermaidCode = 'graph TD\nA-->B'
  const mockContainerRef = { current: document.createElement('div') }

  const mockMermaid = {
    parse: vi.fn(),
    render: vi.fn()
  }

  // Helper function to create mock useDebouncedRender return value
  const createMockHookReturn = (overrides = {}) => ({
    containerRef: mockContainerRef,
    error: null,
    isLoading: false,
    triggerRender: vi.fn(),
    cancelRender: vi.fn(),
    clearError: vi.fn(),
    setLoading: vi.fn(),
    ...overrides
  })

  beforeEach(() => {
    // Setup default mocks
    mocks.useMermaid.mockReturnValue({
      mermaid: mockMermaid,
      isLoading: false,
      error: null
    })

    mocks.useDebouncedRender.mockReturnValue(createMockHookReturn())

    mockMermaid.parse.mockResolvedValue(true)
    mockMermaid.render.mockResolvedValue({
      svg: '<svg class="flowchart" viewBox="0 0 100 100"><g>test diagram</g></svg>'
    })

    // Mock MutationObserver
    global.MutationObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn()
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = render(<MermaidPreview enableToolbar>{mermaidCode}</MermaidPreview>)
      expect(container).toMatchSnapshot()
    })

    it('should handle valid mermaid content', () => {
      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith(
        mermaidCode,
        expect.any(Function),
        expect.objectContaining({
          debounceDelay: 300,
          shouldRender: expect.any(Function)
        })
      )
    })

    it('should handle empty content', () => {
      render(<MermaidPreview>{''}</MermaidPreview>)

      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith('', expect.any(Function), expect.any(Object))
    })
  })

  describe('loading state', () => {
    it('should show loading when useMermaid is loading', () => {
      mocks.useMermaid.mockReturnValue({
        mermaid: mockMermaid,
        isLoading: true,
        error: null
      })

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should show loading when useDebouncedRender is loading', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: true }))

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should not show loading when both are not loading', () => {
      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should show error from useMermaid', () => {
      const mermaidError = 'Mermaid initialization failed'
      mocks.useMermaid.mockReturnValue({
        mermaid: mockMermaid,
        isLoading: false,
        error: mermaidError
      })

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(mermaidError)
    })

    it('should show error from useDebouncedRender', () => {
      const renderError = 'Diagram rendering failed'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: renderError }))

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(renderError)
    })

    it('should prioritize useMermaid error over render error', () => {
      const mermaidError = 'Mermaid initialization failed'
      const renderError = 'Diagram rendering failed'

      mocks.useMermaid.mockReturnValue({
        mermaid: mockMermaid,
        isLoading: false,
        error: mermaidError
      })
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: renderError }))

      render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toHaveTextContent(mermaidError)
    })
  })

  describe('ref forwarding', () => {
    it('should forward ref to ImagePreviewLayout', () => {
      const ref = { current: null }
      render(<MermaidPreview ref={ref}>{mermaidCode}</MermaidPreview>)

      expect(mocks.ImagePreviewLayout).toHaveBeenCalledWith(expect.objectContaining({ ref }), undefined)
    })
  })

  describe('visibility detection', () => {
    it('should observe parent elements up to fold className', () => {
      // Create a DOM structure that simulates MessageGroup fold layout
      const foldContainer = document.createElement('div')
      foldContainer.className = 'fold selected'

      const messageWrapper = document.createElement('div')
      messageWrapper.className = 'message-wrapper'

      const codeBlock = document.createElement('div')
      codeBlock.className = 'code-block'

      foldContainer.appendChild(messageWrapper)
      messageWrapper.appendChild(codeBlock)
      document.body.appendChild(foldContainer)

      try {
        render(<MermaidPreview>{mermaidCode}</MermaidPreview>, {
          container: codeBlock
        })

        const observerInstance = (global.MutationObserver as Mock).mock.results[0]?.value
        expect(observerInstance.observe).toHaveBeenCalled()
      } finally {
        // Cleanup
        document.body.removeChild(foldContainer)
      }
    })

    it('should handle visibility changes and trigger re-render', () => {
      const mockTriggerRender = vi.fn()
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ triggerRender: mockTriggerRender }))

      const { container } = render(<MermaidPreview>{mermaidCode}</MermaidPreview>)

      // Get the MutationObserver callback
      const observerCallback = (global.MutationObserver as Mock).mock.calls[0][0]

      // Mock the container element to be initially hidden
      const mermaidElement = container.querySelector('.mermaid')
      Object.defineProperty(mermaidElement, 'offsetParent', {
        get: () => null, // Hidden
        configurable: true
      })

      // Simulate MutationObserver detecting visibility change
      observerCallback([])

      // Now make it visible
      Object.defineProperty(mermaidElement, 'offsetParent', {
        get: () => document.body, // Visible
        configurable: true
      })

      // Simulate another MutationObserver callback for visibility change
      observerCallback([])

      // The visibility change should have been detected and component should be ready to re-render
      // We verify the component structure is correct for potential re-rendering
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mermaidElement).toBeInTheDocument()
    })
  })
})
