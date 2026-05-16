import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { findLatestPendingPermissionRequest } from '../PermissionRequestComposer'

function makePart(overrides: Partial<Record<string, unknown>> = {}): CherryMessagePart {
  return {
    type: 'tool-Read',
    toolName: 'Read',
    toolCallId: 'call-1',
    state: 'approval-requested',
    input: { file_path: '/tmp/file.ts' },
    approval: { id: 'approval-1' },
    providerExecuted: true,
    callProviderMetadata: {
      'claude-code': {
        rawInput: { file_path: '/tmp/file.ts' },
        parentToolCallId: null
      }
    },
    ...overrides
  } as unknown as CherryMessagePart
}

describe('findLatestPendingPermissionRequest', () => {
  it('finds the latest pending builtin/provider permission request', () => {
    const result = findLatestPendingPermissionRequest({
      'message-1': [makePart()],
      'message-2': [makePart({ toolCallId: 'call-2', approval: { id: 'approval-2' } })]
    })

    expect(result).toMatchObject({
      messageId: 'message-2',
      toolCallId: 'call-2',
      approvalId: 'approval-2',
      title: 'Read',
      toolResponse: {
        tool: { name: 'Read', type: 'provider' },
        status: 'pending',
        arguments: { file_path: '/tmp/file.ts' }
      }
    })
    expect(result?.match).toMatchObject({
      messageId: 'message-2',
      toolCallId: 'call-2',
      approvalId: 'approval-2',
      state: 'approval-requested'
    })
  })

  it('keeps Claude Code MCP-like tool names on the provider permission path', () => {
    const result = findLatestPendingPermissionRequest({
      'message-1': [
        makePart({
          type: 'dynamic-tool',
          toolName: 'mcp__docs__lookup_docs',
          toolCallId: 'mcp-call-1',
          input: { query: 'composer' },
          approval: { id: 'mcp-approval-1' },
          callProviderMetadata: {
            'claude-code': {
              rawInput: { query: 'composer' },
              parentToolCallId: null
            }
          }
        })
      ]
    })

    expect(result).toMatchObject({
      messageId: 'message-1',
      toolCallId: 'mcp-call-1',
      approvalId: 'mcp-approval-1',
      title: 'mcp__docs__lookup_docs',
      toolResponse: {
        tool: {
          name: 'mcp__docs__lookup_docs',
          type: 'provider'
        },
        arguments: { query: 'composer' }
      }
    })
  })

  it('ignores AskUserQuestion, invalid, and already responded tool parts', () => {
    const result = findLatestPendingPermissionRequest({
      'message-1': [
        makePart({ toolName: 'AskUserQuestion', type: 'tool-AskUserQuestion' }),
        makePart({ state: 'approval-responded' }),
        makePart({ approval: undefined }),
        makePart({ toolCallId: undefined }),
        { type: 'text', text: 'hello' } as CherryMessagePart
      ]
    })

    expect(result).toBeNull()
  })
})
