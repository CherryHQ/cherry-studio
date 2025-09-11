import SvgPreview from '@renderer/components/Preview/SvgPreview'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to manage mocks
const mocks = vi.hoisted(() => ({
  ImagePreviewLayout: vi.fn(({ children, loading, error, enableToolbar, source }) => (
    <div data-testid="image-preview-layout" data-source={source}>
      {enableToolbar && <div data-testid="toolbar">Toolbar</div>}
      {loading && <div data-testid="loading">Loading...</div>}
      {error && <div data-testid="error">{error}</div>}
      <div data-testid="preview-content">{children}</div>
    </div>
  )),
  renderSvgInShadowHost: vi.fn(),
  useDebouncedRender: vi.fn()
}))

vi.mock('@renderer/components/Preview/ImagePreviewLayout', () => ({
  default: mocks.ImagePreviewLayout
}))

vi.mock('@renderer/components/Preview/utils', () => ({
  renderSvgInShadowHost: mocks.renderSvgInShadowHost
}))

vi.mock('@renderer/components/Preview/hooks/useDebouncedRender', () => ({
  useDebouncedRender: mocks.useDebouncedRender
}))

describe('SvgPreview', () => {
  const svgContent = '<svg><rect width="100" height="100" /></svg>'
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
      const { container } = render(<SvgPreview enableToolbar>{svgContent}</SvgPreview>)
      expect(container).toMatchSnapshot()
    })

    it('should handle valid svg content', () => {
      render(<SvgPreview>{svgContent}</SvgPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith(
        svgContent,
        expect.any(Function),
        expect.objectContaining({ debounceDelay: 300 })
      )
    })

    it('should handle empty content', () => {
      render(<SvgPreview>{''}</SvgPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith('', expect.any(Function), expect.any(Object))
    })
  })

  describe('loading state', () => {
    it('should show loading indicator when rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: true }))

      render(<SvgPreview>{svgContent}</SvgPreview>)

      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should not show loading indicator when not rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: false }))

      render(<SvgPreview>{svgContent}</SvgPreview>)

      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should show error message when rendering fails', () => {
      const errorMessage = 'Invalid SVG content'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: errorMessage }))

      render(<SvgPreview>{svgContent}</SvgPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(errorMessage)
    })

    it('should not show error when rendering is successful', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: null }))

      render(<SvgPreview>{svgContent}</SvgPreview>)

      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
    })
  })

  describe('custom styling', () => {
    it('should use custom className when provided', () => {
      render(<SvgPreview className="custom-svg-class">{svgContent}</SvgPreview>)

      const content = screen.getByTestId('preview-content')
      const svgContainer = content.querySelector('.custom-svg-class')
      expect(svgContainer).toBeInTheDocument()
    })

    it('should use default className when not provided', () => {
      render(<SvgPreview>{svgContent}</SvgPreview>)

      const content = screen.getByTestId('preview-content')
      const svgContainer = content.querySelector('.svg-preview.special-preview')
      expect(svgContainer).toBeInTheDocument()
    })
  })

  describe('ref forwarding', () => {
    it('should forward ref to ImagePreviewLayout', () => {
      const ref = { current: null }
      render(<SvgPreview ref={ref}>{svgContent}</SvgPreview>)

      // The ref should be passed to ImagePreviewLayout
      expect(mocks.ImagePreviewLayout).toHaveBeenCalledWith(expect.objectContaining({ ref }), undefined)
    })
  })
})
