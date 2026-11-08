import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { useAgentWorkspaceWarning } from '../useAgentWorkspaceWarning'

const { request, t } = vi.hoisted(() => ({ request: vi.fn(), t: (key: string) => key }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }))
beforeEach(() => vi.clearAllMocks())

it('rechecks the same restored path after explicit recovery', async () => {
  request.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'directory' })
  const { result, rerender } = renderHook(({ revision }) => useAgentWorkspaceWarning('/restored', true, revision), {
    initialProps: { revision: 0 }
  })
  await waitFor(() => expect(result.current).toBe('agent.session.workspace_status.inaccessible'))
  rerender({ revision: 1 })
  await waitFor(() => expect(result.current).toBeUndefined())
  expect(request).toHaveBeenCalledTimes(2)
})
