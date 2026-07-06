import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const createDropData = (files: File[]) => ({
  dataTransfer: {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    })),
    types: ['Files']
  }
})

const dropSkillFiles = async (files: File[]) => {
  const dropzone = screen.getByText('library.import_skill_dialog.local.drop_hint').closest('button')
  expect(dropzone).toBeInTheDocument()

  await act(async () => {
    fireEvent.drop(dropzone!, createDropData(files))
  })
}

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
        getPathForFile: vi.fn((file: File) => `/tmp/${file.name}`),
        isDirectory: vi.fn(async () => false),
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

  it('installs multiple dropped ZIP files through the dropzone', async () => {
    const files = [
      new File(['one'], 'one.zip', { type: 'application/zip' }),
      new File(['two'], 'two.zip', { type: 'application/zip' })
    ]
    installFromZip
      .mockResolvedValueOnce({ id: 'skill-one', name: 'Skill One' })
      .mockResolvedValueOnce({ id: 'skill-two', name: 'Skill Two' })

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(installFromZip).toHaveBeenCalledTimes(2))
    expect(window.api.file.getPathForFile).toHaveBeenNthCalledWith(1, files[0])
    expect(window.api.file.getPathForFile).toHaveBeenNthCalledWith(2, files[1])
    expect(window.api.file.isDirectory).toHaveBeenNthCalledWith(1, '/tmp/one.zip')
    expect(window.api.file.isDirectory).toHaveBeenNthCalledWith(2, '/tmp/two.zip')
    expect(installFromZip).toHaveBeenNthCalledWith(1, '/tmp/one.zip')
    expect(installFromZip).toHaveBeenNthCalledWith(2, '/tmp/two.zip')
    expect(installFromDirectory).not.toHaveBeenCalled()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill One')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Skill Two')
    expect(screen.getByText('settings.skills.batchInstallComplete:2')).toBeInTheDocument()
  })

  it('keeps per-file errors for invalid dropped files mixed with ZIPs and directories', async () => {
    const files = [
      new File(['skill'], 'skill-dir', { type: '' }),
      new File(['zip'], 'plugin.zip', { type: 'application/zip' }),
      new File(['readme'], 'readme.txt', { type: 'text/plain' })
    ]
    vi.mocked(window.api.file.isDirectory).mockImplementation(async (path) => path === '/tmp/skill-dir')
    installFromDirectory.mockResolvedValueOnce({ id: 'skill-dir', name: 'Directory Skill' })
    installFromZip.mockResolvedValueOnce({ id: 'skill-zip', name: 'Zip Skill' })

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(installFromDirectory).toHaveBeenCalledWith('/tmp/skill-dir'))
    await waitFor(() => expect(installFromZip).toHaveBeenCalledWith('/tmp/plugin.zip'))
    expect(installFromZip).toHaveBeenCalledTimes(1)
    expect(installFromDirectory).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent(
      'settings.skills.installSuccess:Directory Skill'
    )
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.installSuccess:Zip Skill')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('readme.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('settings.skills.invalidFormat')
    expect(screen.getByText('settings.skills.batchInstallPartialFailed:2:3:1')).toBeInTheDocument()
  })

  it('shows invalid format status for invalid-only dropped files without installing', async () => {
    const files = [
      new File(['one'], 'one.txt', { type: 'text/plain' }),
      new File(['two'], 'two.txt', { type: 'text/plain' }),
      new File(['three'], 'three.txt', { type: 'text/plain' })
    ]

    render(<ImportSkillDialog open onOpenChange={vi.fn()} />)

    await dropSkillFiles(files)

    await waitFor(() => expect(screen.getByTestId('skill-import-results')).toHaveTextContent('one.txt'))
    expect(installFromZip).not.toHaveBeenCalled()
    expect(installFromDirectory).not.toHaveBeenCalled()
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('two.txt')
    expect(screen.getByTestId('skill-import-results')).toHaveTextContent('three.txt')
    expect(screen.getAllByText('settings.skills.invalidFormat')).toHaveLength(4)
    expect(screen.queryByText('settings.skills.batchInstallPartialFailed:0:3:3')).not.toBeInTheDocument()
  })
})
