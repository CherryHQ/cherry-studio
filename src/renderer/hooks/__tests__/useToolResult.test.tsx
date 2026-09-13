import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToolResult } from '../useToolResult'

const ipcRequestMock = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

const TOOL_REF = { topicId: 'agent-session:session-a', messageId: 'message-a', toolCallId: 'bash-a' }

function createWrapper() {
  const cache = new Map()
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  }
}

function deferResult() {
  return Promise.withResolvers<{ found: true; output: string }>()
}

beforeEach(() => {
  ipcRequestMock.mockReset()
})
afterEach(cleanup)

describe('useToolResult', () => {
  it('shares a pending IPC read between consumers of the same tool and refresh version', async () => {
    const pending = deferResult()
    ipcRequestMock.mockReturnValue(pending.promise)
    const { result } = renderHook(
      () => [
        useToolResult(TOOL_REF, { refreshToken: 'running:1' }),
        useToolResult({ ...TOOL_REF }, { refreshToken: 'running:1' })
      ],
      { wrapper: createWrapper() }
    )

    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    expect(ipcRequestMock).toHaveBeenCalledWith('ai.tool.get_result', TOOL_REF)
    await act(async () => pending.resolve({ found: true, output: 'shared output' }))
    expect(result.current.map(({ output }) => output)).toEqual(['shared output', 'shared output'])
  })

  it('keeps terminal output current when an ordinary reader and older refreshes are still pending', async () => {
    const initial = deferResult()
    const running = deferResult()
    const completed = deferResult()
    ipcRequestMock
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(running.promise)
      .mockReturnValueOnce(completed.promise)
    const { result, rerender } = renderHook(
      ({ token }) => [useToolResult(TOOL_REF), useToolResult(TOOL_REF, { refreshToken: token })],
      { initialProps: { token: 'running:1' }, wrapper: createWrapper() }
    )

    rerender({ token: 'completed:2' })
    expect(ipcRequestMock).toHaveBeenCalledTimes(3)
    await act(async () => completed.resolve({ found: true, output: 'final output' }))
    expect(result.current.map(({ output }) => output)).toEqual(['final output', 'final output'])
    await act(async () => {
      initial.resolve({ found: true, output: 'initial output' })
      running.resolve({ found: true, output: 'partial output' })
    })
    expect(result.current.map(({ output }) => output)).toEqual(['final output', 'final output'])
  })

  it('isolates pending tool reads across SWR cache providers', async () => {
    const first = deferResult()
    const second = deferResult()
    ipcRequestMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const left = renderHook(() => useToolResult(TOOL_REF, { refreshToken: 'running:1' }), { wrapper: createWrapper() })
    const right = renderHook(() => useToolResult(TOOL_REF, { refreshToken: 'running:1' }), { wrapper: createWrapper() })

    expect(ipcRequestMock).toHaveBeenCalledTimes(2)
    await act(async () => first.resolve({ found: true, output: 'left output' }))
    expect(left.result.current.output).toBe('left output')
    expect(right.result.current.output).toBeUndefined()
    await act(async () => second.resolve({ found: true, output: 'right output' }))
    expect(right.result.current.output).toBe('right output')
    expect(left.result.current.output).toBe('left output')
  })

  it('exposes a shared read failure and allows a later refresh to recover', async () => {
    const failed = deferResult()
    const recovered = deferResult()
    const failure = new Error('Output read failed')
    ipcRequestMock.mockReturnValueOnce(failed.promise).mockReturnValue(recovered.promise)
    const { result, rerender } = renderHook(
      ({ enabled }) => [
        useToolResult(enabled ? TOOL_REF : undefined, { refreshToken: 'running:1' }),
        useToolResult(enabled ? TOOL_REF : undefined, { refreshToken: 'running:1' })
      ],
      { initialProps: { enabled: true }, wrapper: createWrapper() }
    )

    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    await act(async () => failed.reject(failure))
    expect(result.current.map(({ error }) => error)).toEqual([failure, failure])
    rerender({ enabled: false })
    rerender({ enabled: true })
    expect(ipcRequestMock).toHaveBeenCalledTimes(2)
    await act(async () => recovered.resolve({ found: true, output: 'recovered output' }))
    expect(result.current.map(({ output }) => output)).toEqual(['recovered output', 'recovered output'])
    expect(result.current.map(({ error }) => error)).toEqual([undefined, undefined])
  })
})
