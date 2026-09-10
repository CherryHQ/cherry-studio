import { describe, expect, it } from 'vitest'

import { hasRenderableContent, isHiddenMarkerPart, isRenderablePart } from '../messageRenderability'
import type { CherryMessagePart } from '../types/message'

function part(value: Record<string, unknown>): CherryMessagePart {
  return value as unknown as CherryMessagePart
}

const cherryTransport = { callProviderMetadata: { cherry: { transport: 'claude-agent' } } }

describe('isRenderablePart tool names', () => {
  it('treats pi meta registry tools as visible agent content', () => {
    for (const name of ['tool_search', 'tool_inspect', 'tool_invoke', 'tool_exec']) {
      expect(isRenderablePart(part({ type: `tool-${name}`, toolCallId: 'call-1' }))).toBe(true)
    }
  })

  it('treats agent session delegation tools as visible agent content', () => {
    for (const name of ['session_create', 'session_send']) {
      expect(isRenderablePart(part({ type: `tool-${name}`, toolCallId: 'call-1' }))).toBe(true)
    }
  })

  it('maps cherry runtime-native wire names onto their canonical tools', () => {
    expect(isRenderablePart(part({ type: 'tool-subagent', toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
    expect(isRenderablePart(part({ type: 'tool-bash', toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
    expect(isRenderablePart(part({ type: 'tool-read', toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
  })

  it('does not map runtime-native wire names without cherry transport metadata', () => {
    expect(isRenderablePart(part({ type: 'tool-subagent', toolCallId: 'call-1' }))).toBe(false)
    expect(isRenderablePart(part({ type: 'tool-bash', toolCallId: 'call-1' }))).toBe(false)
  })

  it('treats pi builtins as visible only with cherry transport metadata', () => {
    expect(isRenderablePart(part({ type: 'tool-tool_describe', toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
    expect(isRenderablePart(part({ type: 'tool-tool_call', toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
    expect(isRenderablePart(part({ type: 'tool-tool_describe', toolCallId: 'call-1' }))).toBe(false)
  })

  it('treats the historical builtin AskUserQuestion name as visible', () => {
    expect(
      isRenderablePart(part({ type: 'dynamic-tool', toolCallId: 'call-1', toolName: 'builtin_AskUserQuestion' }))
    ).toBe(true)
  })

  it('rejects tool parts with an unknown renderer name', () => {
    expect(isRenderablePart(part({ type: 'tool-SomeUnknownTool', toolCallId: 'call-1' }))).toBe(false)
  })

  it('rejects tool parts without a tool call identity', () => {
    expect(isRenderablePart(part({ type: 'tool-Bash' }))).toBe(false)
    expect(isRenderablePart(part({ type: 'tool-Bash', toolCallId: '  ' }))).toBe(false)
  })
})

describe('hasRenderableContent', () => {
  it('keeps a tool-only agent turn with transport markers out of the no-response path', () => {
    expect(
      hasRenderableContent([
        part({ type: 'step-start' }),
        part({ type: 'tool-subagent', toolCallId: 'call-1', ...cherryTransport })
      ])
    ).toBe(true)
  })

  it('reports hidden markers and empty text as no visible content', () => {
    expect(hasRenderableContent([part({ type: 'step-start' }), part({ type: 'text', text: '   ' })])).toBe(false)
    expect(isHiddenMarkerPart(part({ type: 'data-no-response-dismissed', data: {} }))).toBe(true)
  })
})
