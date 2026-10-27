import type * as SentryRenderer from '@sentry/electron/renderer'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'

const { captureExceptionMock } = vi.hoisted(() => ({ captureExceptionMock: vi.fn() }))
vi.mock('@sentry/electron/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof SentryRenderer>()),
  captureException: captureExceptionMock
}))

import { ErrorBoundary } from '../ErrorBoundary'

const boomError = new Error('render exploded')

const Bomb = (): never => {
  throw boomError
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    captureExceptionMock.mockReset()
    vi.stubEnv('DEV', false)
    // React logs caught render errors via console.error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('shows the fallback and reports caught render failures independently of logging', () => {
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]).toContain(boomError)
    expect(captureExceptionMock).toHaveBeenCalledExactlyOnceWith(boomError, {
      tags: { 'failure.kind': 'render' },
      extra: { componentStack: expect.stringContaining('Bomb') }
    })
  })

  it('keeps the fallback and caller recovery usable if telemetry fails', () => {
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('Telemetry unavailable')
    })
    const onError = vi.fn()
    render(
      <ErrorBoundary onError={onError}>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onError.mock.calls[0][0]).toBe(boomError)
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
