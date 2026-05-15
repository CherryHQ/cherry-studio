import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useToolApprovalBridge } from '../useToolApprovalBridge'

const mocks = vi.hoisted(() => ({
  patchMessage: vi.fn(),
  respondToolApproval: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({
    trigger: mocks.patchMessage,
    isLoading: false,
    error: undefined
  })
}))

function makeApprovalPart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return {
    type: 'tool-CustomTool',
    toolName: 'CustomTool',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input: { command: 'pnpm test' },
    approval: { id: 'approval-1' },
    ...overrides
  } as unknown as CherryMessagePart
}

describe('useToolApprovalBridge', () => {
  beforeEach(() => {
    mocks.patchMessage.mockReset()
    mocks.patchMessage.mockResolvedValue({ ok: true })
    mocks.respondToolApproval.mockReset()
    mocks.respondToolApproval.mockResolvedValue({ ok: true })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: mocks.respondToolApproval
          }
        }
      }
    })
  })

  it('patches approval decisions onto the latest message parts snapshot', async () => {
    const approvalPart = makeApprovalPart()
    const match: MessageToolApprovalMatch = {
      part: approvalPart,
      state: 'approval-requested',
      toolCallId: 'call-1',
      messageId: 'assistant-1',
      approvalId: 'approval-1',
      input: { command: 'pnpm test' }
    }

    const { result } = renderHook(() =>
      useToolApprovalBridge('topic-1', {
        'assistant-1': [approvalPart]
      })
    )

    await act(async () => {
      await result.current({ match, approved: true })
    })

    expect(mocks.patchMessage).toHaveBeenCalledWith({
      params: { id: 'assistant-1' },
      body: {
        data: {
          parts: [
            expect.objectContaining({
              state: 'approval-responded',
              approval: { id: 'approval-1', approved: true }
            })
          ]
        },
        status: 'pending'
      }
    })
    expect(mocks.respondToolApproval).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      reason: undefined,
      updatedInput: undefined,
      topicId: 'topic-1',
      anchorId: 'assistant-1'
    })
  })
})
