// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { PageSidePanel } from '@cherrystudio/ui'
import i18n from '@renderer/i18n'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return await importOriginal()
})

import AppModalProvider, { type AppModalApi } from '..'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any

  if (!globalThis.PointerEvent) {
    globalThis.PointerEvent = MouseEvent as any
  }
})

afterEach(() => {
  cleanup()
})

async function renderModalProvider() {
  let modal: AppModalApi | undefined

  render(<AppModalProvider onReady={(api) => (modal = api)} />)

  await waitFor(() => {
    expect(modal).toBeDefined()
  })

  return modal!
}

describe('AppModalProvider Dialog integration', () => {
  it('mounts the real Dialog primitive and resolves on confirm', async () => {
    const user = userEvent.setup()
    const modal = await renderModalProvider()

    let confirmed: ReturnType<AppModalApi['confirm']>
    act(() => {
      confirmed = modal.confirm({
        title: 'Real dialog',
        content: 'Mounted through the package dialog.'
      })
    })

    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.confirm') }))

    await expect(confirmed!).resolves.toBe(true)
  })

  it('layers confirm dialogs above in-page side panels', async () => {
    const modal = await renderModalProvider()

    render(<PageSidePanel open onClose={vi.fn()} />)

    act(() => {
      modal.confirm({
        title: 'Delete model',
        content: 'This cannot be undone.',
        okButtonProps: { danger: true }
      })
    })

    expect(await screen.findByText('Delete model')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="page-side-panel-backdrop"]')).toHaveClass('z-[60]')
    expect(document.querySelector('[data-slot="page-side-panel"]')).toHaveClass('z-[70]')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass('z-[90]')
    expect(screen.getByRole('dialog', { name: 'Delete model' })).toHaveClass('z-[90]')
  })
})
