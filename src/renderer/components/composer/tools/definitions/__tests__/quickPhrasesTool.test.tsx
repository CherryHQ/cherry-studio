import { TopicType } from '@renderer/components/composer/tools/types'
import { describe, expect, it } from 'vitest'

import { resolvePromptBindingTarget } from '../quickPhrasesTool'

describe('resolvePromptBindingTarget', () => {
  it('maps chat and quick-assistant scopes to the current Assistant', () => {
    expect(resolvePromptBindingTarget({ scope: TopicType.Chat, assistantId: 'assistant-id' })).toEqual({
      type: 'assistant',
      id: 'assistant-id'
    })
    expect(resolvePromptBindingTarget({ scope: 'quick-assistant', assistantId: 'quick-assistant-id' })).toEqual({
      type: 'assistant',
      id: 'quick-assistant-id'
    })
  })

  it('maps Session scope to the current Agent', () => {
    expect(resolvePromptBindingTarget({ scope: TopicType.Session, agentId: 'agent-id' })).toEqual({
      type: 'agent',
      id: 'agent-id'
    })
  })

  it('keeps painting and missing-context composers global', () => {
    expect(resolvePromptBindingTarget({ scope: 'painting', assistantId: 'assistant-id' })).toBeUndefined()
    expect(resolvePromptBindingTarget({ scope: TopicType.Chat })).toBeUndefined()
    expect(resolvePromptBindingTarget({ scope: TopicType.Session })).toBeUndefined()
  })
})
