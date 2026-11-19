import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { FEEDBACK_MAILTO } from '@shared/utils/officialLinks'

import { WindowFatalFallback } from '../WindowFatalFallback'

const platform = vi.hoisted(() => ({ isDev: false }))
vi.mock('@renderer/utils/platform', () => ({
  get isDev() {
    return platform.isDev
  }
}))

// WindowFatalFallback renders as an error-boundary fallback OUTSIDE every provider
// (ThemeProvider, CommandProvider, ...), so all tests mount it with zero wrappers —
// that absence is itself the contract under test.
describe('WindowFatalFallback', () => {
  // Both buttons dispatch through the typed IpcApi bridge (window.api.ipcApi.request);
  // stub the transport so the fallback's own (provider-free) render stays exercised.
  const request = vi.fn()
  const writeText = vi.fn()

  beforeEach(() => {
    platform.isDev = false
    request.mockReset().mockResolvedValue({ ok: true, data: undefined })
    writeText.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('api', { ipcApi: { request } })
  })

  it('shows only the fault, reload and the details toggle until details are opened', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)

    const card = screen.getByRole('alert')
    expect(card).toHaveTextContent(i18n.t('error.boundary.default.title'))
    expect(card).toHaveTextContent(i18n.t('error.boundary.default.info'))
    expect(card).not.toHaveTextContent('boom from provider')
    expect(screen.queryByRole('button', { name: i18n.t('error.boundary.copy') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    expect(card).toHaveTextContent('Error: boom from provider')
    expect(screen.getByRole('button', { name: i18n.t('error.boundary.copy') })).toBeVisible()
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
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

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
  })

  it('shows the inline action error when clipboard write fails', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.copy') }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('boom from provider'))
    const actionFailed = i18n.t('error.boundary.action_failed')
    const inlineError = await screen.findByText(actionFailed)
    expect(inlineError).toHaveAttribute('role', 'alert')
  })

  it('clears a stale action error once a retry starts, and confirms a successful copy inline', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValueOnce(new Error('clipboard denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<WindowFatalFallback error={new Error('boom from provider')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    const copy = screen.getByRole('button', { name: i18n.t('error.boundary.copy') })

    await user.click(copy)
    expect(await screen.findByText(i18n.t('error.boundary.action_failed'))).toBeInTheDocument()

    await user.click(copy)
    expect(await screen.findByText(i18n.t('common.copied'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('error.boundary.action_failed'))).not.toBeInTheDocument()
  })

  it('opens the download page of the running edition', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('__APP_EDITION__', 'cn')
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    await user.click(screen.getByRole('button', { name: i18n.t('error.update_banner.open_releases') }))

    expect(request).toHaveBeenCalledWith('system.shell.open_external_website', 'https://cherryai.com.cn/download')
  })

  it('opens the feedback mail draft', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.feedback') }))

    expect(request).toHaveBeenCalledWith('system.shell.open_external_website', FEEDBACK_MAILTO)
  })

  it('hides the debug panel entry outside development builds', async () => {
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

    expect(screen.queryByRole('button', { name: i18n.t('error.boundary.default.devtools') })).not.toBeInTheDocument()
  })

  it('opens devtools from a development build', async () => {
    platform.isDev = true
    const user = userEvent.setup()
    render(<WindowFatalFallback error={new Error('boom')} resetErrorBoundary={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))

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
