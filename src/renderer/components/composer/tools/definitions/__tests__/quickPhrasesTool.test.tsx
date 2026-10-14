import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TopicType } from '../../types'
import quickPhrasesTool from '../quickPhrasesTool'

type RuntimeProps = {
  assistantId?: string
  agentId?: string
}

function getRuntimeProps(
  scope: TopicType | 'quick-assistant' | 'painting',
  context: { assistantId?: string; agentId?: string }
): RuntimeProps {
  const Runtime = quickPhrasesTool.composer?.runtime
  if (!Runtime) throw new Error('Quick phrases runtime is not registered')

  const element = (Runtime as (props: unknown) => ReactElement)({
    context: {
      scope,
      actions: { onTextChange: vi.fn() },
      assistant: context.assistantId ? { id: context.assistantId } : undefined,
      session: context.agentId ? { agentId: context.agentId } : undefined,
      launcher: { registerLaunchers: vi.fn() }
    }
  })

  return element.props as RuntimeProps
}

describe('quickPhrasesTool runtime', () => {
  it('passes the Assistant id in Chat and quick-assistant scopes', () => {
    expect(getRuntimeProps(TopicType.Chat, { assistantId: 'assistant-id' })).toMatchObject({
      assistantId: 'assistant-id',
      agentId: undefined
    })
    expect(getRuntimeProps('quick-assistant', { assistantId: 'quick-assistant-id' })).toMatchObject({
      assistantId: 'quick-assistant-id',
      agentId: undefined
    })
  })

  it('passes only the Agent id in Session scope', () => {
    expect(getRuntimeProps(TopicType.Session, { assistantId: 'assistant-id', agentId: 'agent-id' })).toMatchObject({
      assistantId: undefined,
      agentId: 'agent-id'
    })
  })

  it('keeps painting scope global', () => {
    expect(getRuntimeProps('painting', { assistantId: 'assistant-id', agentId: 'agent-id' })).toMatchObject({
      assistantId: undefined,
      agentId: undefined
    })
  })
})
