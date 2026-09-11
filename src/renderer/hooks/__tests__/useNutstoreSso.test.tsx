import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ProtocolData = { url: string }
type ProtocolListener = (data: ProtocolData) => void

const mocks = vi.hoisted(() => ({
  activeListeners: new Set<ProtocolListener>(),
  logger: {
    error: vi.fn(),
    warn: vi.fn()
  },
  on: vi.fn(),
  request: vi.fn(),
  getSsoUrl: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: mocks.on,
    request: mocks.request
  }
}))

import { useNutstoreSso } from '../useNutstoreSso'

function emitProtocolData(url: string) {
  for (const listener of [...mocks.activeListeners]) {
    listener({ url })
  }
}

describe('useNutstoreSso', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.activeListeners.clear()
    mocks.logger.error.mockReset()
    mocks.logger.warn.mockReset()
    mocks.on.mockReset()
    mocks.on.mockImplementation((_event: string, listener: ProtocolListener) => {
      mocks.activeListeners.add(listener)
      return vi.fn(() => mocks.activeListeners.delete(listener))
    })
    mocks.request.mockReset()
    mocks.request.mockResolvedValue(undefined)
    mocks.getSsoUrl.mockReset()
    mocks.getSsoUrl.mockResolvedValue('https://example.com/authorize')
    vi.stubGlobal('api', { nutstore: { getSSOUrl: mocks.getSsoUrl } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('subscribes before launching authorization so an immediate callback is not lost', async () => {
    mocks.request.mockImplementationOnce(() => {
      emitProtocolData('cherrystudio://?s=immediate-token')
      return Promise.resolve()
    })
    const { result } = renderHook(() => useNutstoreSso())

    const pending = result.current()

    await expect(pending).resolves.toEqual({ status: 'success', token: 'immediate-token' })
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_website', 'https://example.com/authorize')
    expect(mocks.activeListeners.size).toBe(0)
  })

  it('reports an authorization URL failure as a launch error and cleans up the listener', async () => {
    const launchError = new Error('authorization URL unavailable')
    mocks.getSsoUrl.mockRejectedValueOnce(launchError)
    const { result } = renderHook(() => useNutstoreSso())

    await expect(result.current()).resolves.toEqual({ status: 'error', reason: 'launch' })
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.activeListeners.size).toBe(0)
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to launch Nutstore SSO authorization', launchError)
  })

  it('reports an asynchronously rejected browser launch and cleans up the listener', async () => {
    const launchError = new Error('browser unavailable')
    mocks.request.mockRejectedValueOnce(launchError)
    const { result } = renderHook(() => useNutstoreSso())

    await expect(result.current()).resolves.toEqual({
      status: 'error',
      reason: 'launch'
    })
    expect(mocks.activeListeners.size).toBe(0)
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to launch Nutstore SSO authorization', launchError)
  })

  it('normalizes a synchronous IpcApi launch failure and cleans up the listener', async () => {
    const launchError = new Error('bridge unavailable')
    mocks.request.mockImplementationOnce(() => {
      throw launchError
    })
    const { result } = renderHook(() => useNutstoreSso())

    await expect(result.current()).resolves.toEqual({
      status: 'error',
      reason: 'launch'
    })
    expect(mocks.activeListeners.size).toBe(0)
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to launch Nutstore SSO authorization', launchError)
  })

  it('accepts only a token-bearing Cherry Studio callback and cleans up after success', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const pending = result.current()

    act(() => {
      emitProtocolData('not a url')
      emitProtocolData('https://example.com/callback?s=wrong-scheme')
      emitProtocolData('cherrystudio://navigate/settings')
      emitProtocolData('cherrystudio://unknown/callback?s=forged-token')
    })

    expect(mocks.activeListeners.size).toBe(1)

    act(() => {
      emitProtocolData('cherrystudio://?s=encrypted-token')
    })

    await expect(pending).resolves.toEqual({ status: 'success', token: 'encrypted-token' })
    expect(mocks.activeListeners.size).toBe(0)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mocks.logger.warn).not.toHaveBeenCalledWith('Nutstore SSO timed out')
  })

  it('reports a root Cherry Studio callback without a token as invalid', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const pending = result.current()

    act(() => {
      emitProtocolData('cherrystudio://?error=invalid_response')
    })

    await expect(pending).resolves.toEqual({ status: 'error', reason: 'invalid_callback' })
    expect(mocks.activeListeners.size).toBe(0)
  })

  it('replaces the previous attempt instead of accumulating listeners', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    mocks.getSsoUrl.mockResolvedValueOnce('https://example.com/first')
    const first = result.current()
    let firstSettled = false
    void first.then(() => {
      firstSettled = true
    })
    mocks.getSsoUrl.mockResolvedValueOnce('https://example.com/second')
    const second = result.current()

    expect(mocks.activeListeners.size).toBe(1)

    act(() => {
      emitProtocolData('cherrystudio://?s=second-token')
    })

    await expect(second).resolves.toEqual({ status: 'success', token: 'second-token' })
    expect(firstSettled).toBe(false)
    expect(mocks.activeListeners.size).toBe(0)
  })

  it('settles and removes an abandoned attempt after the bounded timeout', async () => {
    const { result } = renderHook(() => useNutstoreSso())
    const pending = result.current()

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    await expect(pending).resolves.toEqual({ status: 'error', reason: 'timeout' })
    expect(mocks.activeListeners.size).toBe(0)
    expect(mocks.logger.warn).toHaveBeenCalledWith('Nutstore SSO timed out')
  })

  it('settles cleanly when the protocol subscription cannot be installed', async () => {
    const subscriptionError = new Error('subscription failed')
    mocks.on.mockImplementationOnce(() => {
      throw subscriptionError
    })
    const { result } = renderHook(() => useNutstoreSso())

    await expect(result.current()).resolves.toEqual({
      status: 'error',
      reason: 'listen'
    })
    expect(mocks.activeListeners.size).toBe(0)
    expect(mocks.getSsoUrl).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to listen for Nutstore SSO callback', subscriptionError)
  })

  it('removes the active attempt when the owner unmounts without settling it', async () => {
    const { result, unmount } = renderHook(() => useNutstoreSso())
    const pending = result.current()
    let settled = false
    void pending.then(() => {
      settled = true
    })

    unmount()

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(mocks.activeListeners.size).toBe(0)
  })
})
