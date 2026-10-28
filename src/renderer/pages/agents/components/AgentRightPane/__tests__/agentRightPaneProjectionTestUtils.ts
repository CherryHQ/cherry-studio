import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

const message = (id: string, parts: CherryMessagePart[]): CherryUIMessage =>
  ({
    id,
    role: 'assistant',
    parts,
    metadata: {},
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z'
  }) as CherryUIMessage

const toolPart = (
  toolCallId: string,
  toolName: string,
  parentToolCallId?: string,
  state = 'output-available',
  input?: unknown,
  output?: unknown
): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    output,
    callProviderMetadata: {
      'claude-code': {
        parentToolCallId: parentToolCallId ?? null
      }
    }
  }) as unknown as CherryMessagePart

// A dsh-runtime tool part: runtime-native lowercase name plus the cherry transport tag its
// stream adapter stamps — the tag is what lets the projection resolve the canonical tool name.
const dshToolPart = (
  toolCallId: string,
  toolName: string,
  state: string,
  input?: unknown,
  output?: unknown
): CherryMessagePart =>
  ({
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state,
    input,
    output,
    callProviderMetadata: {
      cherry: { transport: 'dsh-agent', tool: { type: 'builtin', name: toolName } }
    }
  }) as unknown as CherryMessagePart

const textPart = (text: string, parentToolCallId?: string): CherryMessagePart =>
  ({
    type: 'text',
    text,
    providerMetadata: parentToolCallId
      ? {
          'claude-code': {
            parentToolCallId
          }
        }
      : undefined
  }) as unknown as CherryMessagePart

export { message, toolPart, dshToolPart, textPart }
