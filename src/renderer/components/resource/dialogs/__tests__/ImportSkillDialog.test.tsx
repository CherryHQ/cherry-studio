import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const installFromZip = vi.fn()
const installFromDirectory = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key)
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useSkillInstall: () => ({ installFromZip, installFromDirectory })
}))

import { ImportSkillDialog } from '../ImportSkillDialog'

const toastError = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, {
    toast: { ...window.toast, error: toastError },
    api: {
      ...window.api,
      file: {
        ...window.api?.file,
        select: vi.fn(async () => [{ path: '/tmp/broken.zip' }])
      }
    }
  })
})

afterEach(cleanup)

describe('ImportSkillDialog', () => {
  it('shows the failure inline without a second toast (the install hook already toasts)', async () => {
    const user = userEvent.setup()
    installFromZip.mockRejectedValue(new Error('corrupt archive'))

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))

    // The dialog surfaces the error inline...
    await waitFor(() => expect(screen.getByText('corrupt archive')).toBeInTheDocument())
    // ...and does NOT add its own toast on top of the hook's `reportAndRethrowSkillMutationError`.
    expect(toastError).not.toHaveBeenCalled()
  })
})
