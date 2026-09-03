import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { Eye } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FilePreviewModeTabs } from '../FilePreviewToolbar'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentPropsWithoutRef<'button'> & { size?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

describe('FilePreviewModeTabs', () => {
  it('uses stable compact dimensions and centered icon buttons', () => {
    render(
      <FilePreviewModeTabs
        aria-label="View mode"
        value="preview"
        onValueChange={vi.fn()}
        options={[
          { value: 'source', label: 'Source', icon: <Eye /> },
          { value: 'preview', label: 'Preview', icon: <Eye /> }
        ]}
      />
    )

    expect(screen.getByTestId('file-preview-mode-tabs')).toHaveClass('h-7.5', 'items-center', 'p-0.5')
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('inline-flex', 'size-6', 'items-center', 'justify-center', 'leading-none')
    }
  })

  it('keeps both mode buttons the same size while switching modes', () => {
    const onValueChange = vi.fn()
    render(
      <FilePreviewModeTabs
        aria-label="View mode"
        value="preview"
        onValueChange={onValueChange}
        options={[
          { value: 'source', label: 'Source', icon: <Eye /> },
          { value: 'preview', label: 'Preview', icon: <Eye /> }
        ]}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))

    expect(screen.getByRole('tab', { name: 'Source' })).toHaveClass('size-6')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveClass('size-6')
    expect(onValueChange).toHaveBeenCalledWith('source')
  })
})
