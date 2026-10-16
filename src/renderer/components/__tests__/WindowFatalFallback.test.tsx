import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { WindowFatalFallback } from '../WindowFatalFallback'

// WindowFatalFallback renders as an error-boundary fallback OUTSIDE every provider
// (ThemeProvider, CommandProvider, ...), so all tests mount it with zero wrappers —
// that absence is itself the contract under test.
describe('WindowFatalFallback', () => {
  // Both buttons dispatch through the typed IpcApi bridge (window.api.ipcApi.request);
  // stub the transport so the fallback's own (provider-free) render stays exercised.
  const request = vi.fn()

  beforeEach(() => {
    request.mockReset().mockResolvedValue({ ok: true, data: undefined })
    vi.stubGlobal('api', { ipcApi: { request } })
  })

  it('renders the translated fatal message and the error details without any provider', () => {
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('error.boundary.default.message'))
    expect(alert).toHaveTextContent('boom from provider')
  })

  it('reloads the window when the reload button is clicked', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.default.reload') }))

    expect(request).toHaveBeenCalledWith('window.main.reload', undefined)
  })

  it('copies the technical error and exports that same snapshot', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    request.mockResolvedValue({ ok: true, data: { status: 'busy' } })
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.copy') }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('boom from provider'))

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.export') }))
    expect(request).toHaveBeenCalledWith(
      'diagnostics.bundle.export',
      expect.objectContaining({
        includeChatRecords: false,
        includeLogs: true,
        errorContext: expect.objectContaining({
          source: 'renderer',
          operation: 'react.render',
          message: 'boom from provider'
        })
      })
    )
    expect(await screen.findByText(i18n.t('error.boundary.export_busy'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('error.boundary.analysis_unavailable'))).toBeInTheDocument()
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
