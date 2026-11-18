import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImagePreviewLayout from '../ImagePreviewLayout'

const mocks = vi.hoisted(() => ({
  pan: vi.fn(),
  zoom: vi.fn(),
  copy: vi.fn(),
  download: vi.fn(),
  dialog: vi.fn()
}))

vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: vi.fn(() => mocks)
}))

vi.mock('@renderer/components/icons/LoadingIcon', () => ({
  default: () => <div data-testid="loading-indicator" />
}))

vi.mock('../ImageToolbar', () => ({
  default: () => <div data-testid="image-toolbar" />
}))

describe('ImagePreviewLayout', () => {
  const imageRef = { current: null }
  const defaultProps = {
    imageRef,
    source: 'diagram',
    children: <div>Diagram</div>
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading indicator only while rendering', () => {
    const { rerender } = render(<ImagePreviewLayout {...defaultProps} loading />)

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()

    rerender(<ImagePreviewLayout {...defaultProps} loading={false} />)

    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument()
  })

  it('shows rendering errors and withholds the toolbar until recovery', () => {
    const { rerender } = render(<ImagePreviewLayout {...defaultProps} enableToolbar error="Invalid diagram" />)

    expect(screen.getByText('Invalid diagram')).toBeInTheDocument()
    expect(screen.queryByTestId('image-toolbar')).not.toBeInTheDocument()

    rerender(<ImagePreviewLayout {...defaultProps} enableToolbar error={null} />)

    expect(screen.queryByText('Invalid diagram')).not.toBeInTheDocument()
    expect(screen.getByTestId('image-toolbar')).toBeInTheDocument()
  })
})
