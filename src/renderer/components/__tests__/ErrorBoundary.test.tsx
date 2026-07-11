import { loggerService } from '@logger'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
})
