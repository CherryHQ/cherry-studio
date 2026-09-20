import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  snapshot: { revision: 2, phase: 'playing', sessionId: 'session-1', source: 'playback' } as any,
  listeners: new Set<() => void>(),
  initialize: vi.fn(async (): Promise<void> => undefined),
  pause: vi.fn(async (): Promise<void> => undefined),
  resume: vi.fn(async (): Promise<void> => undefined),
  stop: vi.fn(async (): Promise<void> => undefined)
}))

vi.mock('@renderer/services/voice', () => ({
  voiceService: {
    initialize: state.initialize,
    subscribe: (listener: () => void) => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    getSnapshot: () => state.snapshot
  },
  speechPlaybackService: { pause: state.pause, resume: state.resume, stop: state.stop }
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
    vi.clearAllMocks()
    state.initialize.mockResolvedValue(undefined)
    state.pause.mockResolvedValue(undefined)
    state.resume.mockResolvedValue(undefined)
    state.stop.mockResolvedValue(undefined)
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
