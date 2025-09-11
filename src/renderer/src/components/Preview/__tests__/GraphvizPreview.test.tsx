import GraphvizPreview from '@renderer/components/Preview/GraphvizPreview'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to manage mocks
const mocks = vi.hoisted(() => ({
  vizInstance: {
    renderSVGElement: vi.fn()
  },
  vizInitializer: {
    get: vi.fn()
  },
  ImagePreviewLayout: vi.fn(({ children, loading, error, enableToolbar, source }) => (
    <div data-testid="image-preview-layout" data-source={source}>
      {enableToolbar && <div data-testid="toolbar">Toolbar</div>}
      {loading && <div data-testid="loading">Loading...</div>}
      {error && <div data-testid="error">{error}</div>}
      <div data-testid="preview-content">{children}</div>
    </div>
  )),
  useDebouncedRender: vi.fn()
}))

vi.mock('@renderer/components/Preview/ImagePreviewLayout', () => ({
  default: mocks.ImagePreviewLayout
}))

vi.mock('@renderer/utils/asyncInitializer', () => ({
  AsyncInitializer: class {
    constructor() {
      return mocks.vizInitializer
    }
  }
}))

vi.mock('@renderer/components/Preview/hooks/useDebouncedRender', () => ({
  useDebouncedRender: mocks.useDebouncedRender
}))

describe('GraphvizPreview', () => {
  const dotCode = 'digraph { a -> b }'
  const mockContainerRef = { current: document.createElement('div') }

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
    // Setup default successful state
    mocks.useDebouncedRender.mockReturnValue(createMockHookReturn())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('should match snapshot', () => {
      const { container } = render(<GraphvizPreview enableToolbar>{dotCode}</GraphvizPreview>)
      expect(container).toMatchSnapshot()
    })

    it('should handle valid dot code', () => {
      render(<GraphvizPreview>{dotCode}</GraphvizPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith(
        dotCode,
        expect.any(Function),
        expect.objectContaining({ debounceDelay: 300 })
      )
    })

    it('should handle empty content', () => {
      render(<GraphvizPreview>{''}</GraphvizPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith('', expect.any(Function), expect.any(Object))
    })
  })

  describe('loading state', () => {
    it('should show loading indicator when rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: true }))

      render(<GraphvizPreview>{dotCode}</GraphvizPreview>)

      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should not show loading indicator when not rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: false }))

      render(<GraphvizPreview>{dotCode}</GraphvizPreview>)

      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should show error message when rendering fails', () => {
      const errorMessage = 'Invalid dot syntax'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: errorMessage }))

      render(<GraphvizPreview>{dotCode}</GraphvizPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(errorMessage)
    })

    it('should not show error when rendering is successful', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: null }))

      render(<GraphvizPreview>{dotCode}</GraphvizPreview>)

      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
    })
  })

  describe('ref forwarding', () => {
    it('should forward ref to ImagePreviewLayout', () => {
      const ref = { current: null }
      render(<GraphvizPreview ref={ref}>{dotCode}</GraphvizPreview>)

      // The ref should be passed to ImagePreviewLayout
      expect(mocks.ImagePreviewLayout).toHaveBeenCalledWith(expect.objectContaining({ ref }), undefined)
    })
  })
})
