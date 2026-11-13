import { describe, expect, it } from 'vitest'

import { buildToolResponseFromPart } from '@renderer/components/chat/messages/tools/toolResponse'
import type { CherryMessagePart } from '@shared/data/types/message'

import { agentInlineResultPresentationRegistry } from '../agentInlineResultPresentationRegistry'

const navigatePart = {
  type: 'dynamic-tool',
  toolCallId: 'navigate-1',
  toolName: 'mcp__assistant__navigate',
  providerExecuted: true,
  state: 'output-available',
  input: { path: '/settings/provider', query: { id: 'provider-1' } },
  callProviderMetadata: {
    cherry: {
      transport: 'claude-agent',
      tool: { type: 'mcp', name: 'navigate', serverId: 'assistant', serverName: 'assistant' }
    }
  },
  output: {
    content: 'Navigate link created: /settings/provider?id=provider-1',
    metadata: { type: 'mcp', name: 'navigate', serverId: 'assistant', serverName: 'assistant' }
  }
} as CherryMessagePart

describe('agentInlineResultPresentationRegistry', () => {
  it('leaves provider navigate classification and rendering to its existing dispatch', () => {
    const metadata = { type: 'provider', name: 'mcp__assistant__navigate' }
    const part = {
      ...navigatePart,
      callProviderMetadata: { cherry: { tool: metadata } },
      output: { content: 'Navigate link created: /settings/provider?id=provider-1', metadata }
    } as CherryMessagePart
    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('provider')
    expect(agentInlineResultPresentationRegistry.isResultPart(part)).toBe(false)
    expect(agentInlineResultPresentationRegistry.renderResult(response!)).toBeUndefined()
  })
})
