import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { ComputerUseControl } from '@shared/ipc/schemas/computerUse'

import { useAgentDesktopControls } from '../useAgentDesktopControls'

const boundary = vi.hoisted(() => ({
  request: vi.fn(),
  handler: undefined as ((rows: ComputerUseControl[]) => void) | undefined
}))
vi.mock('@renderer/ipc', async () => {
  const { useEffect } = await import('react')
  return {
    ipcApi: { request: boundary.request },
    useIpcOn: (_event: string, handler: (rows: ComputerUseControl[]) => void) => {
      useEffect(() => {
        boundary.handler = handler
        return () => {
          boundary.handler = undefined
        }
      }, [handler])
    }
  }
})
const row: ComputerUseControl = { ownerId: 'agent:s:a', label: 'Agent', appId: 'browser', status: 'active' }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function renderActivityHook() {
  let visible = true
  const hook = renderHook(useAgentDesktopControls, {
    wrapper: ({ children }) => <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
  })
  return {
    ...hook,
    setVisible(value: boolean) {
      visible = value
      hook.rerender()
    }
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  boundary.request.mockReset()
})
afterEach(cleanup)
it('replaces snapshots, including empty snapshots, without reloading', async () => {
  boundary.request.mockResolvedValue([])
  const { result } = renderHook(useAgentDesktopControls)
  await waitFor(() => expect(result.current.controls).toEqual([]))
  act(() => boundary.handler?.([row]))
  expect(result.current.controls).toEqual([row])
  act(() => boundary.handler?.([]))
  expect(result.current.controls).toEqual([])
  expect(ipcApi.request).toHaveBeenCalledTimes(1)
})
it.each(['resolve', 'reject'] as const)('keeps a newer event over late bootstrap %s', async (settlement) => {
  const bootstrap = deferred<ComputerUseControl[]>()
  boundary.request.mockReturnValue(bootstrap.promise)
  const { result } = renderHook(useAgentDesktopControls)
  act(() => boundary.handler?.([row]))
  await act(async () => {
    if (settlement === 'resolve') bootstrap.resolve([])
    else bootstrap.reject(new Error('failed'))
  })
  expect(result.current.controls).toEqual([row])
  expect(result.current.failed).toBe(false)
})
it('reports unknown on failure and recovers from an event', async () => {
  boundary.request.mockRejectedValue(new Error('failed'))
  const { result } = renderHook(useAgentDesktopControls)
  await waitFor(() => expect(result.current.failed).toBe(true))
  expect(result.current.controls).toBeUndefined()
  act(() => boundary.handler?.([]))
  expect(result.current.controls).toEqual([])
  expect(result.current.failed).toBe(false)
})
it('ignores a bootstrap after unmount', async () => {
  const bootstrap = deferred<ComputerUseControl[]>()
  boundary.request.mockReturnValue(bootstrap.promise)
  const { unmount } = renderHook(useAgentDesktopControls)
  unmount()
  await act(async () => bootstrap.resolve([row]))
  expect(boundary.handler).toBeUndefined()
})
it('keeps authoritative rows and clears pending on a rejected stop', async () => {
  const stop = deferred<void>()
  boundary.request.mockResolvedValueOnce([row]).mockReturnValueOnce(stop.promise)
  const { result } = renderHook(useAgentDesktopControls)
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  let request!: Promise<void>
  act(() => {
    request = result.current.stopApp(row)
  })
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
  await act(async () => {
    stop.reject(new Error('failed'))
    await expect(request).rejects.toThrow('failed')
  })
  expect(result.current.pending.size).toBe(0)
  expect(result.current.controls).toEqual([row])
})
it('does not change the status when stop resolves', async () => {
  boundary.request.mockResolvedValueOnce([row]).mockResolvedValueOnce(undefined)
  const { result } = renderHook(useAgentDesktopControls)
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  await act(async () => result.current.stopApp(row))
  expect(result.current.controls).toEqual([row])
})

it.each([
  { name: 'row gone', snapshot: [] },
  { name: 'row active again (tray Allow)', snapshot: [row] }
])('reconciles a stop settled while hidden on Activity resume: $name', async ({ snapshot }) => {
  const stop = deferred<void>()
  boundary.request.mockResolvedValueOnce([row]).mockReturnValueOnce(stop.promise).mockResolvedValueOnce(snapshot)
  const { result, setVisible } = renderActivityHook()
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  let request: Promise<void> = Promise.resolve()
  act(() => {
    request = result.current.stopApp(row)
  })
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
  setVisible(false)
  expect(boundary.handler).toBeUndefined()
  await act(async () => {
    stop.resolve()
    await request
  })
  act(() => boundary.handler?.(snapshot))
  setVisible(true)
  await waitFor(() => expect(result.current.pending.size).toBe(0))
  expect(result.current.controls).toEqual(snapshot)
})

it('reconciles a stop rejected while hidden on Activity resume', async () => {
  const stop = deferred<void>()
  boundary.request.mockResolvedValueOnce([row]).mockReturnValueOnce(stop.promise).mockResolvedValueOnce([row])
  const { result, setVisible } = renderActivityHook()
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  let request: Promise<void> = Promise.resolve()
  act(() => {
    request = result.current.stopApp(row)
  })
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
  setVisible(false)
  expect(boundary.handler).toBeUndefined()
  await act(async () => {
    stop.reject(new Error('failed'))
    await expect(request).rejects.toThrow('failed')
  })
  setVisible(true)
  await waitFor(() => expect(result.current.pending.size).toBe(0))
  expect(result.current.controls).toEqual([row])
})

it('retains an inflight stop for a still-opening row on Activity resume', async () => {
  const stop = deferred<void>()
  const opening: ComputerUseControl = { ...row, status: 'opening' }
  boundary.request.mockResolvedValueOnce([row]).mockReturnValueOnce(stop.promise).mockResolvedValueOnce([opening])
  const { result, setVisible } = renderActivityHook()
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  act(() => {
    void result.current.stopApp(row)
  })
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
  setVisible(false)
  expect(boundary.handler).toBeUndefined()
  setVisible(true)
  await waitFor(() => expect(result.current.controls).toEqual([opening]))
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
})

it.each(['event-before-bootstrap', 'bootstrap-before-event'] as const)(
  'reconciles a stop settled while hidden on Activity resume: %s',
  async (order) => {
    const stop = deferred<void>()
    const bootstrap = deferred<ComputerUseControl[]>()
    boundary.request
      .mockResolvedValueOnce([row])
      .mockReturnValueOnce(stop.promise)
      .mockReturnValueOnce(bootstrap.promise)
    const { result, setVisible } = renderActivityHook()
    await waitFor(() => expect(result.current.controls).toEqual([row]))
    let request: Promise<void> = Promise.resolve()
    act(() => {
      request = result.current.stopApp(row)
    })
    expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
    setVisible(false)
    expect(boundary.handler).toBeUndefined()
    await act(async () => {
      stop.resolve()
      await request
    })
    setVisible(true)
    expect(boundary.handler).toBeDefined()
    if (order === 'event-before-bootstrap') {
      act(() => boundary.handler?.([row]))
      await act(async () => bootstrap.resolve([row]))
    } else {
      await act(async () => bootstrap.resolve([row]))
      act(() => boundary.handler?.([row]))
    }
    expect(result.current.pending.size).toBe(0)
    expect(result.current.controls).toEqual([row])
  }
)

it('keeps a settled stop pending on a plain push without a resume', async () => {
  boundary.request.mockResolvedValueOnce([row]).mockResolvedValueOnce(undefined)
  const { result } = renderHook(useAgentDesktopControls)
  await waitFor(() => expect(result.current.controls).toEqual([row]))
  await act(async () => result.current.stopApp(row))
  act(() => boundary.handler?.([row]))
  expect(result.current.pending.has(JSON.stringify([row.ownerId, row.appId]))).toBe(true)
  expect(result.current.controls).toEqual([row])
})
