import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const importMocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  ensureGroup: vi.fn(),
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
  useAssistantMutations: () => ({ createAssistant: importMocks.createAssistant })
}))

vi.mock('@renderer/hooks/useEnsureAssistantGroup', () => ({
  useEnsureAssistantGroupByName: () => ({ ensureGroup: importMocks.ensureGroup })
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
  importMocks.createAssistant.mockResolvedValue({})
  importMocks.ensureGroup.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    entityType: 'assistant',
    name: 'work',
    orderKey: 'a0',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  })
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

  it('reuses one resolved group for equivalent names within an import batch', async () => {
    importMocks.createAssistant.mockRejectedValue(new Error('create failed'))
    render(<ImportAssistantDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'library.import_dialog.tab.clipboard' }))
    fireEvent.change(screen.getByPlaceholderText('library.import_dialog.clipboard.placeholder'), {
      target: {
        value: JSON.stringify([
          { name: 'First', prompt: 'first prompt', group: [' work '] },
          { name: 'Second', prompt: 'second prompt', group: ['work'] }
        ])
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'library.import_dialog.clipboard.button' }))

    await waitFor(() => expect(importMocks.createAssistant).toHaveBeenCalledTimes(2))
    expect(importMocks.ensureGroup).toHaveBeenCalledTimes(1)
    expect(importMocks.ensureGroup).toHaveBeenCalledWith('work')
    expect(importMocks.createAssistant).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'First', groupId: '11111111-1111-4111-8111-111111111111' })
    )
    expect(importMocks.createAssistant).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'Second', groupId: '11111111-1111-4111-8111-111111111111' })
    )
  })
})
