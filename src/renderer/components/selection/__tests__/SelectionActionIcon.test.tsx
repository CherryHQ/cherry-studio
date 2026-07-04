import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const dynamicIconState = vi.hoisted(() => ({
  render: vi.fn()
}))

vi.mock('lucide-react/dynamic', () => ({
  DynamicIcon: ({ className, name }: { className?: string; name: string }) => {
    dynamicIconState.render(name)
    return <svg className={className} data-icon-name={name} data-testid="dynamic-icon" />
  }
}))

import SelectionActionIcon from '../SelectionActionIcon'

describe('SelectionActionIcon', () => {
  it.each(['languages', 'file-question', 'scan-text', 'search', 'clipboard-copy', 'wand-sparkles', 'quote'])(
    'renders built-in %s without the dynamic icon fallback',
    (name) => {
      dynamicIconState.render.mockClear()

      render(<SelectionActionIcon name={name} data-testid="selection-action-icon" />)

      expect(screen.getByTestId('selection-action-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('dynamic-icon')).not.toBeInTheDocument()
      expect(dynamicIconState.render).not.toHaveBeenCalled()
    }
  )

  it('lazy-loads custom icon names and keeps the provided fallback', async () => {
    render(
      <SelectionActionIcon
        name="custom-icon"
        className="custom-icon-class"
        fallback={() => <span data-testid="custom-icon-fallback" />}
      />
    )

    expect(screen.getByTestId('custom-icon-fallback')).toBeInTheDocument()

    const icon = await screen.findByTestId('dynamic-icon')

    await waitFor(() => expect(dynamicIconState.render).toHaveBeenCalledWith('custom-icon'))
    expect(icon).toHaveAttribute('data-icon-name', 'custom-icon')
    expect(icon).toHaveClass('custom-icon-class')
  })
})
