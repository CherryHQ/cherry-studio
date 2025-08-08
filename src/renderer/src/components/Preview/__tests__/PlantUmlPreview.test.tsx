import PlantUmlPreview from '@renderer/components/Preview/PlantUmlPreview'
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
  useDebouncedRender: vi.fn(),
  logger: {
    warn: vi.fn()
  }
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

describe('PlantUmlPreview', () => {
  const diagram = '@startuml\nA -> B\n@enduml'
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
      const { container } = render(<PlantUmlPreview enableToolbar>{diagram}</PlantUmlPreview>)
      expect(container).toMatchSnapshot()
    })

    it('should handle valid plantuml diagram', () => {
      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith(
        diagram,
        expect.any(Function),
        expect.objectContaining({ debounceDelay: 300 })
      )
    })

    it('should handle empty content', () => {
      render(<PlantUmlPreview>{''}</PlantUmlPreview>)

      // Component should render without throwing
      expect(screen.getByTestId('image-preview-layout')).toBeInTheDocument()
      expect(mocks.useDebouncedRender).toHaveBeenCalledWith('', expect.any(Function), expect.any(Object))
    })
  })

  describe('loading state', () => {
    it('should show loading indicator when rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: true }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      expect(screen.getByTestId('loading')).toBeInTheDocument()
    })

    it('should not show loading indicator when not rendering', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ isLoading: false }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('should show network error message', () => {
      const networkError = 'Network Error: Unable to connect to PlantUML server. Please check your network connection.'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: networkError }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(networkError)
    })

    it('should show syntax error message for invalid diagram', () => {
      const syntaxError =
        'Diagram rendering failed (400): This is likely due to a syntax error in the diagram. Please check your code.'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: syntaxError }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(syntaxError)
    })

    it('should show server error message', () => {
      const serverError =
        'Diagram rendering failed (503): The PlantUML server is temporarily unavailable. Please try again later.'
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: serverError }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(serverError)
    })

    it('should show generic error message for other errors', () => {
      const genericError = "Diagram rendering failed, server returned: 418 I'm a teapot"
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: genericError }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      const errorElement = screen.getByTestId('error')
      expect(errorElement).toBeInTheDocument()
      expect(errorElement).toHaveTextContent(genericError)
    })

    it('should not show error when rendering is successful', () => {
      mocks.useDebouncedRender.mockReturnValue(createMockHookReturn({ error: null }))

      render(<PlantUmlPreview>{diagram}</PlantUmlPreview>)

      expect(screen.queryByTestId('error')).not.toBeInTheDocument()
    })
  })

  describe('ref forwarding', () => {
    it('should forward ref to ImagePreviewLayout', () => {
      const ref = { current: null }
      render(<PlantUmlPreview ref={ref}>{diagram}</PlantUmlPreview>)

      // The ref should be passed to ImagePreviewLayout
      expect(mocks.ImagePreviewLayout).toHaveBeenCalledWith(expect.objectContaining({ ref }), undefined)
    })
  })
})
