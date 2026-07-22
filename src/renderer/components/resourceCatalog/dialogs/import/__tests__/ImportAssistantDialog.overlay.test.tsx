import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const importMocks = vi.hoisted(() => ({
  importAssistant: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/hooks/resourceCatalog/assistantAdapter', () => ({
  useImportAssistantMutation: () => ({ importAssistant: importMocks.importAssistant })
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: importMocks.toastError,
    success: importMocks.toastSuccess
  }
}))

import { ImportAssistantDialog } from '../ImportAssistantDialog'

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

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  importMocks.importAssistant.mockResolvedValue({})
})

describe('ImportAssistantDialog', () => {
  it('uses the shared dialog width instead of a narrower override', () => {
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).toHaveClass('overflow-hidden')
    expect(content).not.toHaveClass('sm:max-w-md')
  })

  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()

    render(<ImportAssistantDialog open onOpenChange={onOpenChange} />)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('delegates normalized group resolution to each atomic import request', async () => {
    const user = userEvent.setup()
    importMocks.importAssistant.mockRejectedValue(new Error('create failed'))
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'library.import_dialog.tab.clipboard' }))
    fireEvent.change(await screen.findByPlaceholderText('library.import_dialog.clipboard.placeholder'), {
      target: {
        value: JSON.stringify([
          { name: 'First', prompt: 'first prompt', group: [' work '] },
          { name: 'Second', prompt: 'second prompt', group: ['work'] }
        ])
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'library.import_dialog.clipboard.button' }))

    await waitFor(() => expect(importMocks.importAssistant).toHaveBeenCalledTimes(2))
    expect(importMocks.importAssistant).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'First', groupName: 'work' })
    )
    expect(importMocks.importAssistant).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'Second', groupName: 'work' })
    )
  })
})
