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

  it('shows a localized conclusion without raw error text inline and keeps reload available', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValue({ ok: true, data: undefined })
    vi.stubGlobal('api', { ipcApi: { request } })
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByText(i18n.t('error.boundary.default.title'))).toBeInTheDocument()
    // Raw text and copy live in the error detail modal, not in the fallback.
    expect(screen.queryByText(boomError.message, { exact: false })).not.toBeInTheDocument()
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
