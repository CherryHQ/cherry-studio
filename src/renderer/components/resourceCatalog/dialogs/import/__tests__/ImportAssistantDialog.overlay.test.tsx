import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'

const importMocks = vi.hoisted(() => ({
  importAssistant: vi.fn(),
  openErrorDetail: vi.fn().mockResolvedValue('opened'),
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

vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  appErrorDetailService: { openAppErrorDetail: importMocks.openErrorDetail }
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
  }
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

  it('reports a failed import by its translated summary and keeps the raw reason behind Details', async () => {
    const user = userEvent.setup()
    const cause = new Error('UNIQUE constraint failed: assistant.name')
    importMocks.importAssistant.mockRejectedValue(cause)
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'library.import_dialog.tab.clipboard' }))
    fireEvent.change(await screen.findByPlaceholderText('library.import_dialog.clipboard.placeholder'), {
      target: { value: JSON.stringify([{ name: 'First', prompt: 'first prompt' }]) }
    })
    fireEvent.click(screen.getByRole('button', { name: 'library.import_dialog.clipboard.button' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('library.import_dialog.failure')
    expect(alert).not.toHaveTextContent(cause.message)
    expect(within(alert).getByRole('button', { name: /common\.detail/ })).toBeInTheDocument()
    expect(importMocks.toastError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'library.import_dialog.failure',
        cause,
        data: expect.objectContaining({ errorContext: expect.objectContaining({ operation: 'assistant.import' }) })
      })
    )
  })

  it.each([404, 429])('keeps the HTTP %s status of a failed URL fetch in its Details', async (status) => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status }))
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'library.import_dialog.tab.url' }))
    fireEvent.change(await screen.findByPlaceholderText('https://gist.github.com/...'), {
      target: { value: 'https://gist.githubusercontent.com/someone/assistant.json' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'library.import_dialog.url.button' }))

    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: /common\.detail/ }))
    await waitFor(() => expect(importMocks.openErrorDetail).toHaveBeenCalledTimes(1))
    expect(importMocks.openErrorDetail.mock.calls[0][0].context.statusCode).toBe(status)
    fetchMock.mockRestore()
  })
})
