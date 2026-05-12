import { render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import SettingsButton from '../SettingsButton'

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children, content }: PropsWithChildren<{ content: string }>) => (
    <div data-testid="settings-tooltip" data-content={content}>
      {children}
    </div>
  )
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

describe('SettingsButton', () => {
  it('uses the parameter settings tooltip', () => {
    render(<SettingsButton onOpenSettings={vi.fn()} />)

    expect(screen.getByTestId('settings-tooltip')).toHaveAttribute('data-content', 'settings.parameter_settings')
  })
})
