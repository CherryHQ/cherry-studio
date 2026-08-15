import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('seeds from the get_status snapshot, then follows pushed events (deepseek-harness)', async () => {
    mocks.request.mockResolvedValue({ status: 'running', url: 'http://127.0.0.1:45231' })
    const { result } = renderHook(() => useManagedToolStatus('deepseek-harness'))

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
    const { result } = renderHook(() => useManagedToolStatus('openclaw'))

    await waitFor(() => expect(result.current).toEqual({ status: 'starting' }))

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running', port: 18790 })
    })
    expect(result.current).toEqual({ status: 'running' })
  })

  it("ignores the other tool's events", async () => {
    mocks.request.mockResolvedValue({ status: 'stopped' })
    const { result } = renderHook(() => useManagedToolStatus('openclaw'))
    await waitFor(() => expect(result.current).toEqual({ status: 'stopped' }))

    await act(async () => {
      emit('deepseek_harness.status_changed', { status: 'running', url: 'http://127.0.0.1:1' })
    })
    expect(result.current).toEqual({ status: 'stopped' })
  })

  it('keeps the stopped default when the initial snapshot request fails, and still applies later events', async () => {
    mocks.request.mockRejectedValue(new Error('ipc unavailable'))
    const { result } = renderHook(() => useManagedToolStatus('openclaw'))

    await act(async () => {})
    expect(result.current).toEqual({ status: 'stopped' })

    await act(async () => {
      emit('openclaw.status_changed', { status: 'running', port: 18790 })
    })
    expect(result.current.status).toBe('running')
  })
})
