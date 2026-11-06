import { renderHook } from '@testing-library/react'
import { t } from 'i18next'
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

it('blocks edit and fork actions for a runtime without native fork support', () => {
  const { result } = renderHook(() =>
    useAgentMessageListProviderValue({
      topic: { id: 'agent-session:source', assistantId: 'agent-1', name: 'Source', messages: [] } as unknown as Topic,
      messages: [
        { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Question' }] },
        {
          id: 'assistant',
          role: 'assistant',
          metadata: { status: 'success' },
          parts: [{ type: 'text', text: 'Answer' }]
        }
      ],
      partsByMessageId: {},
      isLoading: false,
      messageNavigation: 'anchor',
      startEditing: async () => {},
      supportsNativeFork: false
    })
  )
  const [user, assistant] = result.current.state.messages
  expect(result.current.actions.canEditMessage!(user)).toBe(false)
  expect(result.current.actions.startEditing).toBeUndefined()
  expect(result.current.actions.forkSession!.availability(assistant)).toEqual({
    visible: true,
    enabled: false,
    reason: t('agent_session_fork.runtime_unsupported')
  })
})
