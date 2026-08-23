import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  useIpcOn: vi.fn(),
  events: new Map<string, (payload: Record<string, unknown>) => void>()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request }, useIpcOn: mocks.useIpcOn }))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}))

const { useManagedToolStatus } = await import('../useManagedToolStatus')

const emit = (event: string, payload: Record<string, unknown>) => {
  const handler = mocks.events.get(event)
  if (!handler) throw new Error(`${event} handler not registered`)
  handler(payload)
}

describe('useManagedToolStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events.clear()
    mocks.useIpcOn.mockImplementation((event: string, handler: (payload: Record<string, unknown>) => void) => {
      mocks.events.set(event, handler)
    })
  })

  afterEach(() => vi.useRealTimers())

  it('seeds from the get_status snapshot, then follows pushed events (deepseek-harness)', async () => {
    mocks.request.mockResolvedValue({ status: 'running', url: 'http://127.0.0.1:45231' })
    const { result } = renderHook(() => useManagedToolStatus('deepseek-harness', true))

    await waitFor(() => expect(result.current).toEqual({ status: 'running', url: 'http://127.0.0.1:45231' }))

    await act(async () => {
      emit('deepseek_harness.status_changed', { status: 'stopped' })
    })
    expect(result.current).toEqual({ status: 'stopped' })

    await act(async () => {
      emit('deepseek_harness.status_changed', { status: 'running', url: 'http://127.0.0.1:45999' })
    })
    expect(result.current).toEqual({ status: 'running', url: 'http://127.0.0.1:45999' })
  })

  it('carries the snapshot status without a url for openclaw', async () => {
    mocks.request.mockResolvedValue({ status: 'starting' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))

    await waitFor(() => expect(result.current).toEqual({ status: 'starting' }))

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running' })
    })
    expect(result.current).toEqual({ status: 'running' })
  })

  it("ignores the other tool's events", async () => {
    mocks.request.mockResolvedValue({ status: 'stopped' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))
    await waitFor(() => expect(result.current).toEqual({ status: 'stopped' }))

    await act(async () => {
      emit('deepseek_harness.status_changed', { status: 'running', url: 'http://127.0.0.1:1' })
    })
    expect(result.current).toEqual({ status: 'stopped' })
  })

  it('keeps the stopped default when the initial snapshot request fails, and still applies later events', async () => {
    mocks.request.mockRejectedValue(new Error('ipc unavailable'))
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))

    await act(async () => {})
    expect(result.current).toEqual({ status: 'stopped' })

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running' })
    })
    expect(result.current.status).toBe('running')
  })

  it('drops the initial snapshot when an event already delivered newer state', async () => {
    let resolveSnapshot!: (value: { status: string }) => void
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => (resolveSnapshot = resolve)))
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running' })
    })
    expect(result.current).toEqual({ status: 'running' })

    await act(async () => {
      resolveSnapshot({ status: 'stopped' }) // stale bootstrap reply arriving late
    })
    expect(result.current).toEqual({ status: 'running' })
  })

  it('retries a failed initial snapshot until it lands', async () => {
    vi.useFakeTimers()
    mocks.request.mockRejectedValueOnce(new Error('service not ready yet')).mockResolvedValueOnce({ status: 'running' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual({ status: 'stopped' }) // default while the snapshot fails

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current).toEqual({ status: 'running' })
  })

  it('applies a retry result even when an event landed between attempts', async () => {
    vi.useFakeTimers()
    mocks.request.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ status: 'running' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      emit('openclaw.status_changed', { status: 'error' })
    })
    expect(result.current).toEqual({ status: 'error' })

    // The retry is a fresh request issued after the event; its result must heal, not be latched out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current).toEqual({ status: 'running' })
  })

  it('reads nothing and ignores events while the tool is not selected', async () => {
    mocks.request.mockResolvedValue({ status: 'running' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw', false))

    await act(async () => {})
    expect(mocks.request).not.toHaveBeenCalled()

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running' })
    })
    expect(result.current).toEqual({ status: 'stopped' })
  })

  it('snapshots when the tool becomes selected, discovering a gateway started outside the app', async () => {
    mocks.request.mockResolvedValue({ status: 'running' })
    const { result, rerender } = renderHook(({ enabled }) => useManagedToolStatus('openclaw', enabled), {
      initialProps: { enabled: false }
    })
    await act(async () => {})
    expect(result.current).toEqual({ status: 'stopped' })

    rerender({ enabled: true })

    await waitFor(() => expect(result.current).toEqual({ status: 'running' }))
  })

  it('stops retrying after the attempt cap', async () => {
    vi.useFakeTimers()
    mocks.request.mockRejectedValue(new Error('ipc unavailable'))
    renderHook(() => useManagedToolStatus('openclaw', true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 * 10)
    })

    expect(mocks.request.mock.calls.filter(([route]) => route === 'openclaw.get_status')).toHaveLength(5)
  })
})
