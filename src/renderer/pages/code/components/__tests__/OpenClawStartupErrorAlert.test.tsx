import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OpenClawStartupErrorAlert } from '../OpenClawStartupErrorAlert'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('OpenClaw startup error alert', () => {
  it('keeps failure details visible with copy and dismiss actions', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const onDismiss = vi.fn()

    render(
      <OpenClawStartupErrorAlert
        startupError={{ operation: 'openclaw.start_gateway', message: 'Gateway startup timed out' }}
        onCopy={onCopy}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Gateway startup timed out')

    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    await user.click(screen.getByRole('button', { name: 'common.close' }))

    expect(onCopy).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
