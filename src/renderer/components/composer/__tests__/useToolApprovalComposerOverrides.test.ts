import type { CherryMessagePart } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useToolApprovalComposerOverrides } from '../useToolApprovalComposerOverrides'

const askUserQuestionInput = {
  questions: [
    {
      question: 'Choose logger',
      header: 'Logger',
      options: [{ label: 'Winston' }, { label: 'Pino' }],
      multiSelect: false
    }
  ]
}

function makePermissionPart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return {
    type: 'tool-Read',
    toolName: 'Read',
    toolCallId: 'call-read',
    state: 'approval-requested',
    input: { file_path: '/tmp/file.ts' },
    approval: { id: 'approval-read' },
    callProviderMetadata: {
      'claude-code': {
        rawInput: { file_path: '/tmp/file.ts' },
        parentToolCallId: null
      }
    },
    ...overrides
  } as unknown as CherryMessagePart
}

function makeAskUserQuestionPart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return makePermissionPart({
    type: 'dynamic-tool',
    toolName: 'AskUserQuestion',
    toolCallId: 'call-ask',
    input: askUserQuestionInput,
    approval: { id: 'approval-ask' },
    ...overrides
  })
}

describe('useToolApprovalComposerOverrides', () => {
  it('builds shared composer overrides and keeps AskUserQuestion higher priority', () => {
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {
          'message-1': [makePermissionPart(), makeAskUserQuestionPart()]
        },
        onRespond: vi.fn()
      })
    )

    expect(result.current.map((override) => override.id)).toEqual([
      'ask-user-question:approval-ask',
      'tool-permission:approval-read'
    ])
    expect(result.current.map((override) => override.priority)).toEqual([100, 90])
  })

  it('returns no overrides when no pending approvals exist', () => {
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {
          'message-1': [makePermissionPart({ state: 'approval-responded' })]
        },
        onRespond: vi.fn()
      })
    )

    expect(result.current).toEqual([])
  })

  it('optimistically removes permission overrides while a response is pending', async () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {
          'message-1': [makePermissionPart()]
        },
        onRespond
      })
    )

    const override = result.current.find((override) => override.id === 'tool-permission:approval-read')
    const element = override?.render({}) as ReactElement<{ onRespond: (input: any) => Promise<void> }> | undefined

    await act(async () => {
      void element?.props.onRespond({
        match: { approvalId: 'approval-read' }
      })
      await Promise.resolve()
    })

    expect(result.current.map((override) => override.id)).not.toContain('tool-permission:approval-read')
  })

  it('restores permission overrides when an optimistic response fails', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {
          'message-1': [makePermissionPart()]
        },
        onRespond
      })
    )

    const override = result.current.find((override) => override.id === 'tool-permission:approval-read')
    const element = override?.render({}) as ReactElement<{ onRespond: (input: any) => Promise<void> }> | undefined

    await act(async () => {
      await expect(
        element?.props.onRespond({
          match: { approvalId: 'approval-read' }
        })
      ).rejects.toThrow('failed')
    })

    expect(result.current.map((override) => override.id)).toContain('tool-permission:approval-read')
  })
})
