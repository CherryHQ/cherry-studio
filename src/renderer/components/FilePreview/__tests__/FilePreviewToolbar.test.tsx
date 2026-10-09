import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Eye } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FilePreviewModeTabs } from '../FilePreviewToolbar'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<'button'> & { size?: string; variant?: string }) => {
    const buttonProps = { ...props }
    delete buttonProps.size
    delete buttonProps.variant

    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  SegmentedControl: ({
    'aria-label': ariaLabel,
    options,
    onValueChange
  }: {
    'aria-label': string
    options: Array<{ ariaLabel: string; value: string }>
    onValueChange: (value: string) => void
  }) => (
    <div role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" onClick={() => onValueChange(option.value)}>
          {option.ariaLabel}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

describe('FilePreviewModeTabs', () => {
  it('routes mode selection through the shared segmented control', () => {
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

    fireEvent.click(screen.getByRole('radio', { name: 'Source' }))

    expect(onValueChange).toHaveBeenCalledWith('source')
  })
})
