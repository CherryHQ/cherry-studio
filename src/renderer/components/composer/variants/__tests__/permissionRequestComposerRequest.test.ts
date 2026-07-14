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

  it('extracts a request title from descriptive tool input fields', () => {
    const result = findLatestPendingPermissionRequest({
      'message-1': [
        makePart({
          input: {
            command: 'pnpm test',
            description: 'Run focused composer tests'
          }
        })
      ]
    })

    expect(result?.title).toBe('Run focused composer tests')
  })

  it('uses Claude Code MCP metadata for the tool preview', () => {
    const result = findLatestPendingPermissionRequest({
      'message-1': [
        makePart({
          type: 'dynamic-tool',
          toolName: 'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id',
          toolCallId: 'mcp-call-1',
          input: { query: 'composer' },
          approval: { id: 'mcp-approval-1' },
          callProviderMetadata: {
            cherry: {
              transport: 'claude-agent',
              toolName: 'mcp__8171b5f3-c666-4ead-b2ab-bb9ac244af57__resolve-library-id',
              tool: {
                type: 'mcp',
                serverId: '8171b5f3-c666-4ead-b2ab-bb9ac244af57',
                serverName: 'Context7',
                name: 'resolve-library-id',
                description: 'Resolve a package name into a Context7 library ID.'
              }
            },
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
      toolResponse: {
        tool: {
          name: 'resolve-library-id',
          description: 'Resolve a package name into a Context7 library ID.',
          type: 'mcp',
          serverId: '8171b5f3-c666-4ead-b2ab-bb9ac244af57',
          serverName: 'Context7'
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
