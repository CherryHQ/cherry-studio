import { renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'

import type { Topic } from '@renderer/types/topic'
import type { CherryUIMessage } from '@shared/data/types/message'

import { useAgentMessageListProviderValue } from '../agentMessageListAdapter'

it('offers editing on earlier user messages and disables it while the session is busy', () => {
  const messages: CherryUIMessage[] = [
    { id: 'user-a', role: 'user', parts: [{ type: 'text', text: 'Question A' }] },
    { id: 'assistant-a', role: 'assistant', parts: [{ type: 'text', text: 'Answer A' }] },
    { id: 'user-b', role: 'user', parts: [{ type: 'text', text: 'Question B' }] }
  ]
  const { result, rerender } = renderHook(
    ({ editBusy }) =>
      useAgentMessageListProviderValue({
        topic: { id: 'agent-session:source', assistantId: 'agent-1', name: 'Source', messages: [] } as unknown as Topic,
        messages,
        historyActions: {
          'user-a': { fork: 'not_turn_boundary', edit: null },
          'user-b': { fork: 'not_turn_boundary', edit: null }
        },
        partsByMessageId: {},
        isLoading: false,
        messageNavigation: 'anchor',
        startEditing: async () => {},
        editBusy
      }),
    { initialProps: { editBusy: false } }
  )
  const [firstUser, assistant, lastUser] = result.current.state.messages
  expect(result.current.actions.canEditMessage!(firstUser)).toBe(true)
  expect(result.current.actions.canEditMessage!(lastUser)).toBe(true)
  expect(result.current.actions.canEditMessage!(assistant)).toBe(false)
  rerender({ editBusy: true })
  expect(result.current.actions.canEditMessage!(firstUser)).toBe(false)
})

it('does not offer edit without Main checkpoint approval, including unsupported Durable history', () => {
  const { result } = renderHook(() =>
    useAgentMessageListProviderValue({
      topic: { id: 'agent-session:source', assistantId: 'agent-1', name: 'Source', messages: [] } as unknown as Topic,
      messages: [{ id: 'user', role: 'user', parts: [] }],
      partsByMessageId: {},
      isLoading: false,
      messageNavigation: 'anchor',
      startEditing: async () => {},
      historyActions: { user: { fork: 'unsupported_checkpoint', edit: 'checkpoint_unsupported' } }
    })
  )
  expect(result.current.actions.canEditMessage!(result.current.state.messages[0])).toBe(false)
})
