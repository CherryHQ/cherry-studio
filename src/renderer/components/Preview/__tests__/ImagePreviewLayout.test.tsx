import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import ImagePreviewLayout from '../ImagePreviewLayout'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

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

  // Parser output is technical evidence; the detail's explanation slot must be translated text.
  it('explains a render failure with translated text and keeps the parser output as the cause', async () => {
    const parserText = 'Parse error on line 2: unexpected token'
    render(<ImagePreviewLayout {...defaultProps} error={parserText} cause={new Error(parserText)} />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const request = detailMocks.open.mock.calls[0][0]
    expect(request.localizedErrorMessage).toBe(i18n.t('preview.render.failed'))
    expect(request.localizedErrorMessage).not.toBe(parserText)
    expect(request.error.message).toBe(parserText)
  })
})
