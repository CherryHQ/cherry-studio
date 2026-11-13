import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'

import { ErrorBoundary } from '../ErrorBoundary'

const boomError = new Error('render exploded')

const Bomb = (): never => {
  throw boomError
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught render errors via console.error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs caught render errors through loggerService', () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]).toContain(boomError)
  })

  it('composes a caller-supplied onError with the default logging', () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => {})
    const customOnError = vi.fn()

    render(
      <ErrorBoundary onError={customOnError}>
        <Bomb />
      </ErrorBoundary>
    )

    expect(customOnError).toHaveBeenCalledTimes(1)
    expect(customOnError.mock.calls[0]).toContain(boomError)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('discloses error details on demand and keeps recovery actions available', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue({ ok: true, data: undefined })
    vi.stubGlobal('api', { ipcApi: { request } })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    const details = screen.getByText(boomError.message)
    expect(details).not.toBeVisible()
    await user.click(screen.getByText(i18n.t('error.boundary.details')))
    expect(details).toBeVisible()
    await user.click(screen.getByRole('button', { name: i18n.t('common.copy') }))
    expect(writeText).toHaveBeenCalledWith(boomError.message)
    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.default.devtools') }))
    expect(request).toHaveBeenCalledWith('system.toggle_dev_tools', undefined)
    await user.click(screen.getByRole('button', { name: i18n.t('error.boundary.default.reload') }))
    expect(request).toHaveBeenCalledWith('window.main.reload', undefined)
  })

  // B6: the boundary wraps every window's provider stack (incl. the lightest
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
      await import('../ErrorBoundary')
      expect(loaded).not.toHaveBeenCalled()
    } finally {
      for (const dep of heavyDeps) {
        vi.doUnmock(dep)
      }
      vi.resetModules()
    }
  })
})
