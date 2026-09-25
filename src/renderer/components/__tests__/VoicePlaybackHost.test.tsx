import { mockToast } from '@test-mocks/renderer/toast'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceDomainError } from '@renderer/services/voice'
import type * as VoiceModule from '@renderer/services/voice'

vi.unmock('@cherrystudio/ui')

const state = vi.hoisted(() => ({
  snapshot: { revision: 2, phase: 'playing', sessionId: 'session-1', source: 'playback' } as any,
  listeners: new Set<() => void>(),
  playbackListeners: new Set<() => void>(),
  retryableSessionId: undefined as string | undefined,
  initialize: vi.fn(async (): Promise<void> => undefined),
  retry: vi.fn(async (): Promise<void> => undefined),
  pause: vi.fn(async (): Promise<void> => undefined),
  resume: vi.fn(async (): Promise<void> => undefined),
  stop: vi.fn(async (): Promise<void> => undefined)
}))

vi.mock('@renderer/services/voice', async (importOriginal) => ({
  VoiceDomainError: (await importOriginal<typeof VoiceModule>()).VoiceDomainError,
  voiceService: {
    initialize: state.initialize,
    subscribe: (listener: () => void) => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    getSnapshot: () => state.snapshot
  },
  speechPlaybackService: {
    pause: state.pause,
    resume: state.resume,
    stop: state.stop,
    retry: state.retry,
    canRetry: (sessionId: string) => state.retryableSessionId === sessionId,
    subscribe: (listener: () => void) => {
      state.playbackListeners.add(listener)
      return () => state.playbackListeners.delete(listener)
    }
  }
}))

import { VoicePlaybackHost } from '../VoicePlaybackHost'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

describe('VoicePlaybackHost', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.useRealTimers()
    state.snapshot = { revision: 2, phase: 'playing', sessionId: 'session-1', source: 'playback' }
    state.retryableSessionId = undefined
    vi.clearAllMocks()
    state.retry.mockReset().mockResolvedValue(undefined)
    state.initialize.mockResolvedValue(undefined)
    state.pause.mockResolvedValue(undefined)
    state.resume.mockResolvedValue(undefined)
    state.stop.mockReset().mockResolvedValue(undefined)
  })

  it('uses Main playback state and sends explicit-session controls', async () => {
    render(<VoicePlaybackHost />)

    expect(await screen.findByRole('status')).toHaveTextContent(/playing/i)
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    fireEvent.click(screen.getByRole('button', { name: /(stop|停止)/i }))

    expect(state.pause).toHaveBeenCalledWith('session-1')
    expect(state.stop).toHaveBeenCalledWith('session-1')
  })

  it('renders no global bar for non-playback state and resumes a paused session', async () => {
    const view = render(<VoicePlaybackHost />)
    act(() => {
      state.snapshot = { revision: 3, phase: 'paused', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })

    fireEvent.click(await screen.findByRole('button', { name: /resume/i }))
    expect(state.resume).toHaveBeenCalledWith('session-1')

    act(() => {
      state.snapshot = { revision: 4, phase: 'recording', sessionId: 'session-2', source: 'dictation' }
      state.listeners.forEach((listener) => listener())
    })
    await waitFor(() => expect(view.queryByRole('status')).not.toBeInTheDocument())
  })

  it('closes a failed playback instead of offering inactive playback controls', async () => {
    const user = userEvent.setup()
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    render(<VoicePlaybackHost />)

    expect(screen.getByRole('status')).toHaveTextContent('Playback failed')
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Close' })
    await user.hover(close)
    expect(await screen.findByRole('tooltip', { name: 'Close' })).toBeVisible()
    await user.click(close)

    expect(state.stop).toHaveBeenCalledWith('session-1')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    act(() => {
      state.snapshot = { revision: 4, phase: 'playing', sessionId: 'session-2', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    expect(screen.getByRole('status')).toHaveTextContent('Playing')
  })

  it('dismisses an obsolete failure when its playback session has already ended', async () => {
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.stop.mockRejectedValueOnce(new VoiceDomainError('invalid_request'))
    render(<VoicePlaybackHost />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('offers retry when retained audio becomes available and stays busy until playback recovers', async () => {
    const user = userEvent.setup()
    const retried = deferred<void>()
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.retry.mockReturnValueOnce(retried.promise)
    render(<VoicePlaybackHost />)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    act(() => {
      state.retryableSessionId = 'session-1'
      state.playbackListeners.forEach((listener) => listener())
    })
    const retry = screen.getByRole('button', { name: 'Retry' })
    await user.hover(retry)
    expect(await screen.findByRole('tooltip', { name: 'Retry' })).toBeVisible()
    await user.click(retry)
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
    expect(state.retry).toHaveBeenCalledWith('session-1')

    await act(async () => {
      state.snapshot = { revision: 4, phase: 'playing', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
      retried.resolve()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Playing')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('restores retry and close with feedback after a retry fails', async () => {
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.retryableSessionId = 'session-1'
    state.retry.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    render(<VoicePlaybackHost />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The voice operation failed. Try again.'))
    expect(screen.getByRole('status')).toHaveTextContent('Playback failed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('does not offer another session’s retained audio or let its pending retry affect a newer session', async () => {
    const retried = deferred<void>()
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.retryableSessionId = 'session-1'
    state.retry.mockReturnValueOnce(retried.promise)
    render(<VoicePlaybackHost />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))

    act(() => {
      state.snapshot = { revision: 4, phase: 'failed', sessionId: 'session-2', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    act(() => {
      state.retryableSessionId = 'session-2'
      state.playbackListeners.forEach((listener) => listener())
    })
    await act(async () => retried.reject(new VoiceDomainError('operation_failed')))

    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(mockToast.error).not.toHaveBeenCalled()
  })

  it('keeps the failed session visible when cleanup fails for a reason other than an ended session', async () => {
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.stop.mockRejectedValueOnce(new VoiceDomainError('operation_failed'))
    render(<VoicePlaybackHost />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The voice operation failed. Try again.'))
    expect(screen.getByRole('status')).toHaveTextContent('Playback failed')
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
  })

  it('shows tooltips for pause, resume, and stop', async () => {
    const user = userEvent.setup()
    render(<VoicePlaybackHost />)

    for (const label of ['Pause', 'Stop']) {
      const button = screen.getByRole('button', { name: label })
      await user.hover(button)
      expect(await screen.findByRole('tooltip', { name: label })).toBeVisible()
      await user.unhover(button)
    }
    act(() => {
      state.snapshot = { revision: 3, phase: 'paused', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    await user.hover(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('tooltip', { name: 'Resume' })).toBeVisible()
  })

  it('does not dismiss a newer failure when an older close operation settles', async () => {
    const stopped = deferred<void>()
    state.snapshot = { revision: 3, phase: 'failed', sessionId: 'session-1', source: 'playback' }
    state.stop.mockReturnValueOnce(stopped.promise)
    render(<VoicePlaybackHost />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))

    act(() => {
      state.snapshot = { revision: 4, phase: 'failed', sessionId: 'session-2', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    await act(async () => stopped.resolve())

    expect(screen.getByRole('status')).toHaveTextContent('Playback failed')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(state.stop).toHaveBeenLastCalledWith('session-2')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('retries a transient initialization failure and recovers the host', async () => {
    vi.useFakeTimers()
    state.initialize.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(undefined)
    render(<VoicePlaybackHost />)
    await act(async () => undefined)
    expect(state.initialize).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(state.initialize).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).not.toHaveTextContent(/operation failed/i)
  })

  it('cancels pending initialization retries on unmount', async () => {
    vi.useFakeTimers()
    state.initialize.mockRejectedValue(new Error('offline'))
    const view = render(<VoicePlaybackHost />)
    await act(async () => undefined)
    expect(state.initialize).toHaveBeenCalledOnce()

    view.unmount()
    await act(async () => vi.runAllTimersAsync())
    expect(state.initialize).toHaveBeenCalledOnce()
  })

  it('hides an initialization failure after Main advances the same session revision', async () => {
    vi.useFakeTimers()
    state.initialize.mockRejectedValue(new Error('offline'))
    render(<VoicePlaybackHost />)
    await act(async () => vi.runAllTimersAsync())
    expect(state.initialize).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('status')).toHaveTextContent(/operation failed/i)

    act(() => {
      state.snapshot = { revision: 3, phase: 'playing', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    expect(screen.getByRole('status')).toHaveTextContent(/playing/i)
    expect(screen.getByRole('status')).not.toHaveTextContent(/operation failed/i)
  })

  it('does not let an old control failure pollute a newer session', async () => {
    const pause = deferred<void>()
    state.pause.mockReturnValueOnce(pause.promise)
    render(<VoicePlaybackHost />)
    fireEvent.click(await screen.findByRole('button', { name: /pause/i }))

    act(() => {
      state.snapshot = { revision: 3, phase: 'playing', sessionId: 'session-2', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    pause.reject(new Error('old session failed'))
    await act(async () => pause.promise.catch(() => undefined))

    expect(screen.getByRole('status')).toHaveTextContent(/playing/i)
    expect(screen.getByRole('status')).not.toHaveTextContent(/operation failed/i)
  })

  it('does not let a late control rejection pollute a higher revision of the same session', async () => {
    const pause = deferred<void>()
    state.pause.mockReturnValueOnce(pause.promise)
    render(<VoicePlaybackHost />)
    fireEvent.click(await screen.findByRole('button', { name: /pause/i }))

    act(() => {
      state.snapshot = { revision: 3, phase: 'playing', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    pause.reject(new Error('stale revision failed'))
    await act(async () => pause.promise.catch(() => undefined))

    expect(screen.getByRole('status')).toHaveTextContent(/playing/i)
    expect(screen.getByRole('status')).not.toHaveTextContent(/operation failed/i)
  })

  it('clears a control failure for a higher revision and ignores an older operation in the same session', async () => {
    state.pause.mockRejectedValueOnce(new Error('pause failed'))
    render(<VoicePlaybackHost />)
    fireEvent.click(await screen.findByRole('button', { name: /pause/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/operation failed/i))

    act(() => {
      state.snapshot = { revision: 3, phase: 'playing', sessionId: 'session-1', source: 'playback' }
      state.listeners.forEach((listener) => listener())
    })
    expect(screen.getByRole('status')).toHaveTextContent(/playing/i)

    const oldPause = deferred<void>()
    state.pause.mockReturnValueOnce(oldPause.promise)
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    oldPause.reject(new Error('older operation failed'))
    await act(async () => oldPause.promise.catch(() => undefined))
    expect(screen.getByRole('status')).not.toHaveTextContent(/operation failed/i)
  })
})
