import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import type { MessageListItem, MessageUiState } from '../../types'
import {
  getEffectiveMultiModelMessageStyle,
  isAssistantMultiModelGroup,
  shouldUseWideLayoutForMessageGroup
} from '../messageGroupLayout'

const createMessage = (id: string, role: MessageListItem['role'] = 'assistant') =>
  ({
    id,
    parentId: role === 'assistant' ? 'ask-1' : undefined,
    role,
    topicId: 'topic-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success'
  }) as MessageListItem

const createGetMessageUiState = (style?: MultiModelMessageStyle) => (): MessageUiState => ({
  multiModelMessageStyle: style
})

describe('messageGroupLayout', () => {
  it('detects assistant multi-model groups', () => {
    expect(isAssistantMultiModelGroup([createMessage('assistant-1'), createMessage('assistant-2')])).toBe(true)
    expect(isAssistantMultiModelGroup([createMessage('assistant-1')])).toBe(false)
    expect(isAssistantMultiModelGroup([createMessage('user-1', 'user'), createMessage('assistant-1')])).toBe(false)
  })

  it('uses the persisted group style before the default style', () => {
    const messages = [createMessage('assistant-1'), createMessage('assistant-2')]

    expect(getEffectiveMultiModelMessageStyle(messages, createGetMessageUiState('grid'), 'horizontal')).toBe('grid')
  })

  it('uses wide layout for horizontal and grid assistant groups', () => {
    const messages = [createMessage('assistant-1'), createMessage('assistant-2')]

    expect(shouldUseWideLayoutForMessageGroup(messages, createGetMessageUiState('horizontal'), 'fold', false)).toBe(
      true
    )
    expect(shouldUseWideLayoutForMessageGroup(messages, createGetMessageUiState('grid'), 'fold', false)).toBe(true)
  })

  it('keeps narrow layout for fold, vertical, user groups, and multi-select mode', () => {
    const messages = [createMessage('assistant-1'), createMessage('assistant-2')]

    expect(shouldUseWideLayoutForMessageGroup(messages, createGetMessageUiState('fold'), 'horizontal', false)).toBe(
      false
    )
    expect(shouldUseWideLayoutForMessageGroup(messages, createGetMessageUiState('vertical'), 'horizontal', false)).toBe(
      false
    )
    expect(
      shouldUseWideLayoutForMessageGroup(
        [createMessage('user-1', 'user')],
        createGetMessageUiState('grid'),
        'grid',
        false
      )
    ).toBe(false)
    expect(shouldUseWideLayoutForMessageGroup(messages, createGetMessageUiState('grid'), 'grid', true)).toBe(false)
  })
})
