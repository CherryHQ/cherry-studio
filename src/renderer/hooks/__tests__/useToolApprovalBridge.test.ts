import type { MessageToolApprovalMatch } from '@renderer/components/chat/messages/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useToolApprovalBridge } from '../useToolApprovalBridge'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const mocks = vi.hoisted(() => ({
  respondToolApproval: vi.fn(),
  toastWarning: vi.fn()
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

function makeApprovalMatch(): MessageToolApprovalMatch {
  const approvalPart = makeApprovalPart()
  return {
    part: approvalPart,
    state: 'approval-requested',
    toolCallId: 'call-1',
    messageId: 'assistant-1',
    approvalId: 'approval-1',
    input: { command: 'pnpm test' }
  }
}

describe('useToolApprovalBridge', () => {
  beforeEach(() => {
    mocks.respondToolApproval.mockReset()
    mocks.respondToolApproval.mockResolvedValue({ ok: true })
    mocks.toastWarning.mockReset()

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
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        warning: mocks.toastWarning
      }
    })
  })

  it('delivers approval decisions to main with anchor context', async () => {
    const match = makeApprovalMatch()

    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await act(async () => {
      await result.current({ match, approved: true })
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

  it('throws when main does not accept the approval response', async () => {
    mocks.respondToolApproval.mockResolvedValueOnce({ ok: false })
    const match = makeApprovalMatch()
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).rejects.toThrow('Tool approval response was not accepted')
  })

  it('throws when delivery to main fails', async () => {
    mocks.respondToolApproval.mockRejectedValueOnce(new Error('ipc boom'))
    const match = makeApprovalMatch()
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).rejects.toThrow('ipc boom')
  })

  it('shows a timeout notice when main expires a stale approval', async () => {
    mocks.respondToolApproval.mockResolvedValueOnce({ ok: true, status: 'expired' })
    const match = makeApprovalMatch()
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await act(async () => {
      await result.current({ match, approved: true })
    })

    expect(mocks.toastWarning).toHaveBeenCalledWith('agent.toolPermission.toast.timeout')
  })
})
