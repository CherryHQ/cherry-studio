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
    t: (key: string, opts?: Record<string, string | number>) => {
      if (!opts) return key
      if ('name' in opts) return `${key}:${opts.name}`
      if ('count' in opts) return `${key}:${opts.count}`
      if ('success' in opts && 'total' in opts && 'failed' in opts) {
        return `${key}:${opts.success}:${opts.total}:${opts.failed}`
      }
      return key
    }
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
        select: vi.fn(async () => [{ name: 'broken.zip', path: '/tmp/broken.zip' }])
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

  it('installs every selected ZIP and keeps batch results visible', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    vi.mocked(window.api.file.select).mockResolvedValue([
      { name: 'one.zip', path: '/tmp/one.zip' },
      { name: 'two.zip', path: '/tmp/two.zip' }
    ] as any)
    installFromZip
      .mockResolvedValueOnce({ id: 'skill-one', name: 'Skill One' })
      .mockResolvedValueOnce({ id: 'skill-two', name: 'Skill Two' })

    render(<ImportSkillDialog open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromZip' }))

    await waitFor(() => expect(installFromZip).toHaveBeenCalledTimes(2))
    expect(window.api.file.select).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
    )
    expect(installFromZip).toHaveBeenNthCalledWith(1, '/tmp/one.zip')
    expect(installFromZip).toHaveBeenNthCalledWith(2, '/tmp/two.zip')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill One')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill Two')
    expect(screen.getByText('settings.skills.batchInstallComplete:2')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('installs every selected directory and keeps batch results visible', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.file.select).mockResolvedValue([
      { name: 'skill-one', path: '/tmp/skill-one' },
      { name: 'skill-two', path: '/tmp/skill-two' }
    ] as any)
    installFromDirectory
      .mockResolvedValueOnce({ id: 'skill-one', name: 'Skill One' })
      .mockResolvedValueOnce({ id: 'skill-two', name: 'Skill Two' })

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'settings.skills.installFromDirectory' }))

    await waitFor(() => expect(installFromDirectory).toHaveBeenCalledTimes(2))
    expect(window.api.file.select).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory', 'multiSelections'] })
    )
    expect(installFromDirectory).toHaveBeenNthCalledWith(1, '/tmp/skill-one')
    expect(installFromDirectory).toHaveBeenNthCalledWith(2, '/tmp/skill-two')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill One')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill Two')
    expect(screen.getByText('settings.skills.batchInstallComplete:2')).toBeInTheDocument()
  })
})
