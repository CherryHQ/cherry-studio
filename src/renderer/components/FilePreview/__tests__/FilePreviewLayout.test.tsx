import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FilePreviewLayout } from '../FilePreviewLayout'
import { FilePreviewToolbar } from '../FilePreviewToolbar'

afterEach(cleanup)

describe('FilePreview layout composition', () => {
  it('renders content without reserving an empty toolbar row', () => {
    render(
      <FilePreviewLayout.Frame>
        <FilePreviewLayout.Content>Preview content</FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-preview-content')).toHaveTextContent('Preview content')
  })

  it('lets a plugin compose its toolbar before the content', () => {
    render(
      <FilePreviewLayout.Frame>
        <FilePreviewToolbar aria-label="PDF preview tools">
          <button type="button">Zoom in</button>
        </FilePreviewToolbar>
        <FilePreviewLayout.Content>PDF content</FilePreviewLayout.Content>
      </FilePreviewLayout.Frame>
    )

    const toolbar = screen.getByRole('toolbar', { name: 'PDF preview tools' })
    expect(toolbar).toHaveClass('h-10')
    expect(toolbar).not.toHaveClass('bg-background')
    expect(toolbar.firstElementChild).toHaveClass('mx-auto', 'justify-center')
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByTestId('file-preview-content')).toHaveTextContent('PDF content')
  })
})
