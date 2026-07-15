import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OriginalTextCopyButton from '../OriginalTextCopyButton'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('OriginalTextCopyButton', () => {
  beforeEach(() => {
    mocks.writeText.mockReset()
    mocks.toastError.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText }
    })
  })

  it('shows a check without a toast after copying', async () => {
    mocks.writeText.mockResolvedValue(undefined)
    render(<OriginalTextCopyButton textToCopy="selected text" tooltip="Copy original" />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy original' }))

    expect(mocks.writeText).toHaveBeenCalledWith('selected text')
    expect(document.querySelector('.lucide-check')).toBeInTheDocument()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows the localized error when copying fails', async () => {
    mocks.writeText.mockRejectedValue(new Error('denied'))
    render(<OriginalTextCopyButton textToCopy="selected text" tooltip="Copy original" />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy original' }))

    expect(mocks.toastError).toHaveBeenCalledWith('message.copy.failed')
  })
})
