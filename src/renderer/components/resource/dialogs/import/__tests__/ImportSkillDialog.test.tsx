import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const installFromZip = vi.fn()
const installFromDirectory = vi.fn()

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

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

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
})

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
  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open when clicking the overlay while installing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    let resolveInstall: (value: unknown) => void = () => {}
    installFromZip.mockReturnValue(new Promise((resolve) => (resolveInstall = resolve)))

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))
    await waitFor(() => expect(installFromZip).toHaveBeenCalledWith('/tmp/broken.zip'))

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).not.toHaveBeenCalled()

    resolveInstall(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'settings.skills.installFromZip' })).toBeEnabled())
  })

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
