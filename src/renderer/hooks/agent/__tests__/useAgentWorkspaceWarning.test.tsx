import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useAgentWorkspaceStatus, useAgentWorkspaceWarning } from '../useAgentWorkspaceWarning'

const { request, t } = vi.hoisted(() => ({ request: vi.fn(), t: (key: string) => key }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
beforeEach(() => vi.clearAllMocks())

it('rechecks the same restored path after explicit recovery', async () => {
  request.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const { result, rerender } = renderHook(({ revision }) => useAgentWorkspaceWarning('/restored', true, revision), {
    initialProps: { revision: 0 }
  })
  await waitFor(() => expect(result.current).toBe('agent.session.workspace_status.inaccessible'))
  rerender({ revision: 1 })
  await waitFor(() => expect(result.current).toBeUndefined())
  expect(request).toHaveBeenCalledTimes(2)
})

it('warns when an existing directory is unreadable', async () => {
  request.mockResolvedValue(false)
  const { result } = renderHook(() => useAgentWorkspaceWarning('/unreadable'))
  await waitFor(() => expect(result.current).toBe('agent.session.workspace_status.inaccessible'))
  expect(request).toHaveBeenCalledWith('ai.agent.workspace.is_accessible', { path: '/unreadable' })
})

it('keeps availability pending until the response and discards a previous path or revision', async () => {
  let resolve!: (available: boolean) => void
  request.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      })
  )
  const { result, rerender } = renderHook(({ path, revision }) => useAgentWorkspaceStatus(path, true, revision), {
    initialProps: { path: '/first', revision: 0 }
  })
  expect(result.current.available).toBeUndefined()
  await act(async () => {
    resolve(false)
  })
  expect(result.current.available).toBe(false)
  rerender({ path: '/second', revision: 0 })
  expect(result.current.available).toBeUndefined()
  await act(async () => {
    resolve(true)
  })
  expect(result.current.available).toBe(true)
  rerender({ path: '/second', revision: 1 })
  expect(result.current.available).toBeUndefined()
})

it('does not reuse the previous positive result when revisiting A before B settles', async () => {
  const replies: Array<(available: boolean) => void> = []
  request.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        replies.push(resolve)
      })
  )
  const { result, rerender } = renderHook(({ path }) => useAgentWorkspaceStatus(path), {
    initialProps: { path: '/a' }
  })
  await act(async () => {
    replies[0](true)
  })
  expect(result.current.available).toBe(true)
  rerender({ path: '/b' })
  expect(result.current.available).toBeUndefined()
  rerender({ path: '/a' })
  expect(result.current.available).toBeUndefined()
  await act(async () => {
    replies[1](true)
  })
  expect(result.current.available).toBeUndefined()
  await act(async () => {
    replies[2](false)
  })
  expect(result.current.available).toBe(false)
})
