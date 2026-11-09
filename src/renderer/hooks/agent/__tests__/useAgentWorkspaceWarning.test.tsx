import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useAgentWorkspaceWarning } from '../useAgentWorkspaceWarning'

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
