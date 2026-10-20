import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { useActiveSession, useSessions } from '@renderer/hooks/agent/useSession'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { useSessionArchiveActions } from '../useArchiveActions'

vi.unmock('@data/hooks/useDataApi')
const request = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/tab', () => ({ useCloseConversationTabs: () => vi.fn() }))

const restoredSession: AgentSessionEntity = {
  id: 'restored-session',
  agentId: 'restored-agent',
  name: 'Restored task',
  workspaceId: 'workspace-1',
  workspace: {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  },
  orderKey: 'a0',
  isNameManuallyEdited: false,
  lastActivityAt: '2024-01-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z'
}

describe('restored session selection', () => {
  it.each(['undo', 'archive'] as const)(
    'selects a task restored through %s without retaining its archived not-found result',
    async (source) => {
      const cache = new Map()
      const wrapper = ({ children }: PropsWithChildren) =>
        createElement(SWRConfig, { value: { provider: () => cache } }, children)
      vi.mocked(dataApiService.get).mockRejectedValue(DataApiErrorFactory.notFound('Session', restoredSession.id))
      request.mockResolvedValue(restoredSession)
      const initialProps: { id: string | null } = { id: restoredSession.id }
      const { result, rerender } = renderHook(
        ({ id }: { id: string | null }) => ({
          active: useActiveSession({ activeSessionId: id, setActiveSessionId: vi.fn() }),
          source: useSessions(undefined, { enabled: false }),
          archive: useSessionArchiveActions(async () => undefined)
        }),
        { initialProps, wrapper }
      )
      await waitFor(() => expect(result.current.active.error).toBeDefined())
      rerender({ id: null })
      vi.mocked(dataApiService.get).mockResolvedValue(restoredSession)
      await act(async () => {
        if (source === 'undo') await result.current.source.restoreSession(restoredSession.id)
        else
          await result.current.archive.onRestore({ id: restoredSession.id, name: restoredSession.name, deletedAt: 1 })
      })
      rerender({ id: restoredSession.id })

      expect(result.current.active.error).toBeUndefined()
      expect(result.current.active.session).toEqual(restoredSession)
    }
  )
})
