import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ClaudeScopedSettingsCard from '../ClaudeScopedSettingsCard'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('ClaudeScopedSettingsCard', () => {
  it('reflects the value and toggles it', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(<ClaudeScopedSettingsCard checked={false} onToggle={onToggle} />)
    const control = screen.getByRole('switch', { name: 'code.claude_scope.title' })
    expect(control).not.toBeChecked()
    await userEvent.click(control)
    expect(onToggle).toHaveBeenCalledWith(true)
    rerender(<ClaudeScopedSettingsCard checked onToggle={onToggle} />)
    expect(control).toBeChecked()
  })
  it.each(['disabled', 'busy'] as const)('is inert when %s', async (state) => {
    const onToggle = vi.fn()
    render(<ClaudeScopedSettingsCard checked={false} onToggle={onToggle} {...{ [state]: true }} />)
    const control = screen.getByRole('switch')
    expect(control).toBeDisabled()
    await userEvent.click(control)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
