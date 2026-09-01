import { useImageTools } from '@renderer/components/ActionTools'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImagePreviewLayout from '../ImagePreviewLayout'
import type { BasicPreviewHandles } from '../types'

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

  it('exposes the image actions through its public ref', () => {
    const ref = { current: null as BasicPreviewHandles | null }

    render(<ImagePreviewLayout {...defaultProps} ref={ref} />)

    expect(ref.current).toMatchObject({
      pan: mocks.pan,
      zoom: mocks.zoom,
      copy: mocks.copy,
      download: mocks.download
    })
  })

  it('enables drag and wheel zoom by default', () => {
    render(<ImagePreviewLayout {...defaultProps} />)

    expect(useImageTools).toHaveBeenCalledWith(
      defaultProps.imageRef,
      expect.objectContaining({
        enableDrag: true,
        enableWheelZoom: true
      })
    )
  })

  it('forwards explicit drag and wheel zoom settings to useImageTools', () => {
    render(<ImagePreviewLayout {...defaultProps} enableDrag={false} enableWheelZoom={false} />)

    expect(useImageTools).toHaveBeenCalledWith(
      defaultProps.imageRef,
      expect.objectContaining({
        enableDrag: false,
        enableWheelZoom: false
      })
    )
  })
})
