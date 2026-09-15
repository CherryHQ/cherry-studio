import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { AssistantPresetPreviewDialog } from '../AssistantPresetPreviewDialog'

const preset = {
  description: 'Build a focused assistant',
  group: ['Featured'],
  name: 'Focused Assistant',
  prompt: 'Stay concise'
}

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

describe('AssistantPresetPreviewDialog overlay close', () => {
  it('shows inline provider guidance and exposes its configuration action', () => {
    const onConfigureProvider = vi.fn()

    render(
      <AssistantPresetPreviewDialog
        preset={preset}
        open
        configurationProviderId="anthropic"
        onOpenChange={vi.fn()}
        onAdd={vi.fn()}
        onOpenChat={vi.fn()}
        onConfigureProvider={onConfigureProvider}
      />
    )

    expect(screen.getByText('library.assistant_catalog.provider_required_title')).toBeInTheDocument()
    expect(screen.getByText('library.assistant_catalog.provider_required_description')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'navigate.provider_settings' }))
    expect(onConfigureProvider).toHaveBeenCalledWith('anthropic')
  })

  it('closes when clicking the overlay while idle', () => {
    const onOpenChange = vi.fn()

    render(
      <AssistantPresetPreviewDialog
        preset={preset}
        open
        onOpenChange={onOpenChange}
        onAdd={vi.fn()}
        onOpenChat={vi.fn()}
      />
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open when clicking the overlay while adding', () => {
    const onOpenChange = vi.fn()

    render(
      <AssistantPresetPreviewDialog
        preset={preset}
        open
        adding
        onOpenChange={onOpenChange}
        onAdd={vi.fn()}
        onOpenChat={vi.fn()}
      />
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
