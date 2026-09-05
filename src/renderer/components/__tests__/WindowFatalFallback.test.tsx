import i18n from '@renderer/i18n/resolver'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WindowFatalFallback } from '../WindowFatalFallback'

// WindowFatalFallback renders as an error-boundary fallback OUTSIDE every provider
// (ThemeProvider, CommandProvider, ...), so all tests mount it with zero wrappers —
// that absence is itself the contract under test.
describe('WindowFatalFallback', () => {
  // Both buttons dispatch through the typed IpcApi bridge (window.api.ipcApi.request);
  // stub the transport so the fallback's own (provider-free) render stays exercised.
  const request = vi.fn()
  const writeText = vi.fn()

  beforeEach(() => {
    request.mockReset().mockResolvedValue({ ok: true, data: undefined })
    writeText.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('api', { ipcApi: { request } })
  })

  it('renders the translated fatal message and the error details without any provider', () => {
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('error.boundary.default.message'))
    expect(alert).toHaveTextContent('boom from provider')
  })

  it('keeps error details selectable and copies them from the provider-free fallback', async () => {
    const user = userEvent.setup()
    const errorMessage = 'boom from provider\nRetry after reopening the window'
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    render(<WindowFatalFallback error={new Error(errorMessage)} resetErrorBoundary={vi.fn()} />)

    const details = screen.getByText((_, element) => element?.textContent === errorMessage)
    // The global body rule disables selection; this class is the user-visible bug contract.
    expect(details).toHaveClass('selectable')

    await user.click(screen.getByRole('button', { name: i18n.t('common.copy') }))

    expect(writeText).toHaveBeenCalledWith(errorMessage)
  })

  it('reloads the window when the reload button is clicked', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.default.reload') }))

    expect(request).toHaveBeenCalledWith('window.main.reload', undefined)
  })

  it('opens devtools when the devtools button is clicked', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.default.devtools') }))

    expect(request).toHaveBeenCalledWith('system.toggle_dev_tools', undefined)
  })

  it('removes the boot spinner overlay so the fallback stays clickable', () => {
    const spinner = document.createElement('div')
    spinner.id = 'spinner'
    document.body.appendChild(spinner)

    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)

    expect(document.getElementById('spinner')).toBeNull()
  })

  // B6: this fallback is on every window's first-screen graph (incl. the lightest
  // selection toolbar), so it must not statically reach the heavy error bucket.
  it('does not statically reach zod/ai/axios through its import graph', async () => {
    vi.resetModules()
    const loaded = vi.fn()
    const heavyDeps = ['zod', 'ai', 'axios']
    for (const dep of heavyDeps) {
      vi.doMock(dep, async (importOriginal) => {
        loaded(dep)
        return await importOriginal()
      })
    }

    try {
      await import('../WindowFatalFallback')
      expect(loaded).not.toHaveBeenCalled()
    } finally {
      for (const dep of heavyDeps) {
        vi.doUnmock(dep)
      }
      vi.resetModules()
    }
  })
})
