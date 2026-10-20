import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { CherryMessagePart } from '@shared/data/types/message'

import { useToolApprovalComposerOverrides } from '../useToolApprovalComposerOverrides'
import {
  getAskUserQuestionDraftCacheKey,
  readAskUserQuestionDraftCache,
  writeAskUserQuestionDraftCache
} from '../variants/askUserQuestionDraftCache'

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
  beforeEach(() => MockCacheUtils.resetMocks())

  it('builds shared composer overrides and keeps AskUserQuestion higher priority', () => {
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        persistedPartsByMessageId: {},
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
        persistedPartsByMessageId: {},
        partsByMessageId: {
          'message-1': [makePermissionPart({ state: 'approval-responded' })]
        },
        onRespond: vi.fn()
      })
    )

    expect(result.current).toEqual([])
  })

  it('masks a stale historical approval with the current live message', () => {
    const historicalPart = makeAskUserQuestionPart()
    const currentPart = makeAskUserQuestionPart({ state: 'approval-responded' })
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        persistedPartsByMessageId: {},
        partsByMessageId: { 'message-1': [currentPart] },
        streamingLayers: {
          historyPartsByMessageId: { 'message-1': [historicalPart] },
          liveMessageIds: ['message-1']
        },
        onRespond: vi.fn()
      })
    )

    expect(result.current).toEqual([])
  })

  it('keeps the queue head until refreshed parts advance to the next permission', async () => {
    let resolveResponse: (() => void) | undefined
    const onRespond = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResponse = resolve
        })
    )
    const firstPart = makePermissionPart()
    const secondPart = makePermissionPart({
      toolCallId: 'call-write',
      approval: { id: 'approval-write' },
      type: 'tool-Write',
      toolName: 'Write'
    })
    const { result, rerender } = renderHook(
      ({ partsByMessageId }) =>
        useToolApprovalComposerOverrides({ partsByMessageId, persistedPartsByMessageId: {}, onRespond }),
      {
        initialProps: {
          partsByMessageId: { 'message-1': [firstPart, secondPart] }
        }
      }
    )

    const override = result.current.find((override) => override.id === 'tool-permission:approval-read')
    const element = override?.render({}) as ReactElement<{ onRespond: (input: any) => Promise<void> }> | undefined

    let response: Promise<void> | undefined
    act(() => {
      response = element?.props.onRespond({
        match: { approvalId: 'approval-read' }
      })
    })

    expect(result.current.map((override) => override.id)).toContain('tool-permission:approval-read')
    expect(result.current.map((override) => override.id)).not.toContain('tool-permission:approval-write')

    await act(async () => {
      resolveResponse?.()
      await response
    })

    // The IPC success alone is not a second source of truth: the same persisted parts keep A visible.
    expect(result.current.map((override) => override.id)).toContain('tool-permission:approval-read')
    expect(result.current.map((override) => override.id)).not.toContain('tool-permission:approval-write')

    rerender({
      partsByMessageId: {
        'message-1': [makePermissionPart({ state: 'approval-responded' }), secondPart]
      }
    })

    expect(result.current.map((override) => override.id)).not.toContain('tool-permission:approval-read')
    expect(result.current.map((override) => override.id)).toContain('tool-permission:approval-write')
    expect(onRespond).toHaveBeenCalledTimes(1)
  })

  it('keeps the queue head when its response fails', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() =>
      useToolApprovalComposerOverrides({
        persistedPartsByMessageId: {},
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

describe('AskUserQuestion draft settlement', () => {
  const draft = { selectedAnswers: { 0: ['Winston'] }, customAnswers: { 0: 'Keep JSON logs' }, currentIndex: 0 }

  beforeEach(() => {
    MockCacheUtils.resetMocks()
    writeAskUserQuestionDraftCache('approval-ask', draft)
    writeAskUserQuestionDraftCache('approval-other', draft)
  })

  it.each([
    { state: 'approval-responded', approved: true },
    { state: 'approval-responded', approved: false },
    { state: 'output-available', approved: true },
    { state: 'output-denied', approved: false }
  ])('clears only the matching draft for persisted $state (approved=$approved) on mount', ({ state, approved }) => {
    const settled = makeAskUserQuestionPart({
      state,
      approval: { id: 'approval-ask', approved },
      input: approved ? { ...askUserQuestionInput, answers: { 'Choose logger': 'Winston' } } : askUserQuestionInput
    })
    renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {},
        persistedPartsByMessageId: { 'message-1': [settled] },
        onRespond: vi.fn()
      })
    )

    expect(cacheService.has(getAskUserQuestionDraftCacheKey('approval-ask'))).toBe(false)
    expect(readAskUserQuestionDraftCache('approval-other')).toEqual(draft)
  })

  it('keeps the draft through live answers and a missing card until database parts settle', () => {
    const pending = makeAskUserQuestionPart()
    const answered = makeAskUserQuestionPart({
      state: 'output-available',
      input: { ...askUserQuestionInput, answers: { 'Choose logger': 'Winston' } }
    })
    const liveParts: Record<string, CherryMessagePart[]> = { 'message-1': [answered] }
    const pendingParts: Record<string, CherryMessagePart[]> = { 'message-1': [pending] }
    const { rerender, unmount } = renderHook(
      ({ partsByMessageId, persistedPartsByMessageId }) =>
        useToolApprovalComposerOverrides({
          partsByMessageId,
          persistedPartsByMessageId,
          streamingLayers: { historyPartsByMessageId: liveParts, liveMessageIds: ['message-1'] },
          onRespond: vi.fn()
        }),
      { initialProps: { partsByMessageId: liveParts, persistedPartsByMessageId: pendingParts } }
    )
    expect(readAskUserQuestionDraftCache('approval-ask')).toEqual(draft)

    rerender({ partsByMessageId: {}, persistedPartsByMessageId: {} })
    unmount()
    expect(readAskUserQuestionDraftCache('approval-ask')).toEqual(draft)

    renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: pendingParts,
        persistedPartsByMessageId: liveParts,
        streamingLayers: { historyPartsByMessageId: pendingParts, liveMessageIds: ['message-1'] },
        onRespond: vi.fn()
      })
    )
    expect(cacheService.has(getAskUserQuestionDraftCacheKey('approval-ask'))).toBe(false)
  })

  it('does not treat a pending question or an unrelated completed tool as a settled answer', () => {
    renderHook(() =>
      useToolApprovalComposerOverrides({
        partsByMessageId: {},
        persistedPartsByMessageId: {
          'message-1': [
            makeAskUserQuestionPart(),
            makePermissionPart({ state: 'output-available', approval: { id: 'approval-other' } })
          ]
        },
        onRespond: vi.fn()
      })
    )
    expect(readAskUserQuestionDraftCache('approval-ask')).toEqual(draft)
    expect(readAskUserQuestionDraftCache('approval-other')).toEqual(draft)
  })
})
