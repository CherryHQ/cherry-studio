import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImagePreviewLayout from '../ImagePreviewLayout'

const mocks = vi.hoisted(() => ({
  useImageTools: vi.fn(() => ({
    pan: vi.fn(),
    zoom: vi.fn(),
    copy: vi.fn(),
    download: vi.fn(),
    dialog: vi.fn()
  }))
}))

// Mock antd components
vi.mock('antd', () => ({
  Spin: ({ children, spinning }: any) => (
    <div data-testid="spin" data-spinning={spinning}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div data-testid="spinner">Spinner</div>
}))

// Mock ImageToolbar
vi.mock('../ImageToolbar', () => ({
  default: () => <div data-testid="image-toolbar">ImageToolbar</div>
}))

// Mock styles
vi.mock('../styles', () => ({
  PreviewContainer: ({ children, vertical }: any) => (
    <div data-testid="preview-container" data-vertical={vertical}>
      {children}
    </div>
  ),
  PreviewError: ({ children }: any) => <div data-testid="preview-error">{children}</div>
}))

// Mock useImageTools
vi.mock('@renderer/components/ActionTools/hooks/useImageTools', () => ({
  useImageTools: mocks.useImageTools
}))

describe('ImagePreviewLayout', () => {
  const mockImageRef = { current: null }

  const defaultProps = {
    imageRef: mockImageRef,
    source: 'test-source',
    children: <div>Test Content</div>
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should match snapshot', () => {
    const { container } = render(<ImagePreviewLayout {...defaultProps} />)
    expect(container).toMatchSnapshot()
  })

  it('should render children correctly', () => {
    render(<ImagePreviewLayout {...defaultProps} />)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('should show loading state when loading is true', () => {
    render(<ImagePreviewLayout {...defaultProps} loading={true} />)
    expect(screen.getByTestId('spin')).toHaveAttribute('data-spinning', 'true')
  })

  it('should not show loading state when loading is false', () => {
    render(<ImagePreviewLayout {...defaultProps} loading={false} />)
    expect(screen.getByTestId('spin')).toHaveAttribute('data-spinning', 'false')
  })

  it('should display error message when error is provided', () => {
    const errorMessage = 'Test error message'
    render(<ImagePreviewLayout {...defaultProps} error={errorMessage} />)
    expect(screen.getByText(errorMessage)).toBeInTheDocument()
  })

  it('should not display error message when error is null', () => {
    render(<ImagePreviewLayout {...defaultProps} error={null} />)
    expect(screen.queryByText('preview-error')).not.toBeInTheDocument()
  })

  it('should render ImageToolbar when enableToolbar is true and no error', () => {
    render(<ImagePreviewLayout {...defaultProps} enableToolbar={true} />)
    expect(screen.getByTestId('image-toolbar')).toBeInTheDocument()
  })

  it('should not render ImageToolbar when enableToolbar is false', () => {
    render(<ImagePreviewLayout {...defaultProps} enableToolbar={false} />)
    expect(screen.queryByTestId('image-toolbar')).not.toBeInTheDocument()
  })

  it('should not render ImageToolbar when there is an error', () => {
    render(<ImagePreviewLayout {...defaultProps} enableToolbar={true} error="Error occurred" />)
    expect(screen.queryByTestId('image-toolbar')).not.toBeInTheDocument()
  })

  it('should call useImageTools with correct parameters', () => {
    render(<ImagePreviewLayout {...defaultProps} />)

    // Verify useImageTools was called with correct parameters
    expect(mocks.useImageTools).toHaveBeenCalledWith(
      mockImageRef,
      expect.objectContaining({
        imgSelector: 'svg',
        prefix: 'test-source',
        enableDrag: true,
        enableWheelZoom: true
      })
    )
  })
})
