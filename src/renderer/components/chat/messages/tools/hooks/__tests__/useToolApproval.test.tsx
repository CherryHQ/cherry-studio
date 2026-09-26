import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { useToolApproval } from '../useToolApproval'

const mocks = vi.hoisted(() => ({ respondToolApproval: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@renderer/components/chat/messages/blocks/MessagePartsContext', () => ({
  usePartsMap: () => ({
    'message-1': [
      {
        type: 'tool-bash',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: {},
        approval: { id: 'approval-1' }
      }
    ]
  })
}))
vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ respondToolApproval: mocks.respondToolApproval })
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] }),
  useMcpServerMutations: () => ({ updateMcpServer: vi.fn() })
}))

describe('useToolApproval', () => {
  it('sends a bare user denial without a localized reason', async () => {
    const target = { id: 'call-1', toolCallId: 'call-1' } as NormalToolResponse
    const { result } = renderHook(() => useToolApproval(target))

    await act(async () => result.current.cancel())

    expect(mocks.respondToolApproval).toHaveBeenCalledWith({
      match: expect.objectContaining({ approvalId: 'approval-1', toolCallId: 'call-1' }),
      approved: false
    })
  })
})
