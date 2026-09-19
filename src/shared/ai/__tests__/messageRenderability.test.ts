import { describe, expect, it } from 'vitest'

import type { CherryMessagePart } from '@shared/data/types/message'

import { hasRenderableContent, isHiddenMarkerPart, isRenderablePart } from '../messageRenderability'

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

  it('rejects ordinary-chat read_file calls that render no card', () => {
    expect(isRenderablePart(part({ type: 'tool-read_file', toolCallId: 'call-1' }))).toBe(false)
    expect(isRenderablePart(part({ type: 'tool-read_file', toolCallId: 'call-1', ...cherryTransport }))).toBe(false)
  })

  it('ignores runtime wire names under an unknown transport tag', () => {
    const bogusTransport = { callProviderMetadata: { cherry: { transport: 'bogus-agent' } } }
    expect(isRenderablePart(part({ type: 'tool-bash', toolCallId: 'call-1', ...bogusTransport }))).toBe(false)
  })

  it('treats caller-defined dynamic tool calls as visible gateway content', () => {
    expect(isRenderablePart(part({ type: 'dynamic-tool', toolCallId: 'call-1', toolName: 'myGatewayTool' }))).toBe(true)
    expect(isRenderablePart(part({ type: 'dynamic-tool', toolName: 'myGatewayTool' }))).toBe(false)
  })

  it('treats dsh runtime-native builtins as visible agent content', () => {
    for (const name of [
      'read_image',
      'get_goal',
      'create_goal',
      'update_goal',
      'send_message',
      'interrupt_agent',
      'list_agents'
    ]) {
      expect(isRenderablePart(part({ type: `tool-${name}`, toolCallId: 'call-1', ...cherryTransport }))).toBe(true)
    }
  })

  it('does not treat dsh runtime-native names as visible without cherry transport metadata', () => {
    expect(isRenderablePart(part({ type: 'tool-read_image', toolCallId: 'call-1' }))).toBe(false)
    expect(isRenderablePart(part({ type: 'tool-send_message', toolCallId: 'call-1' }))).toBe(false)
  })

  it('counts only valid report_artifacts calls as visible', () => {
    const validInput = { artifacts: [{ path: '/tmp/report.md' }] }
    expect(isRenderablePart(part({ type: 'tool-report_artifacts', toolCallId: 'call-1', input: validInput }))).toBe(
      true
    )
    expect(isRenderablePart(part({ type: 'tool-report_artifacts', toolCallId: 'call-1', input: undefined }))).toBe(
      false
    )
    expect(
      isRenderablePart(part({ type: 'tool-report_artifacts', toolCallId: 'call-1', input: { artifacts: [] } }))
    ).toBe(false)
    expect(
      isRenderablePart(
        part({ type: 'tool-mcp__cherry__report_artifacts', toolCallId: 'call-1', input: { artifacts: [] } })
      )
    ).toBe(false)
  })
})

describe('isRenderablePart file addressability', () => {
  it('treats managed-storage and file-URL parts as visible', () => {
    expect(isRenderablePart(part({ type: 'file', mediaType: 'text/markdown', url: 'file:///tmp/note.md' }))).toBe(true)
    expect(
      isRenderablePart(
        part({
          type: 'file',
          mediaType: 'text/markdown',
          url: 'file:///tmp/note.md',
          providerMetadata: { cherry: { fileEntryId: '01a066b1-2d81-76ca-a828-018c02068f88' } }
        })
      )
    ).toBe(true)
  })

  it('rejects entry-only parts the completed renderer hides behind its URL gate', () => {
    expect(
      isRenderablePart(
        part({
          type: 'file',
          mediaType: 'text/markdown',
          providerMetadata: { cherry: { fileEntryId: '01a066b1-2d81-76ca-a828-018c02068f88' } }
        })
      )
    ).toBe(false)
  })

  it('rejects filename-only and remote-URL parts that render nothing', () => {
    expect(isRenderablePart(part({ type: 'file', mediaType: 'text/markdown', filename: 'note.md' }))).toBe(false)
    expect(
      isRenderablePart(part({ type: 'file', mediaType: 'text/markdown', url: 'https://example.com/note.md' }))
    ).toBe(false)
  })

  it('renders image parts from any URL but not without one', () => {
    expect(isRenderablePart(part({ type: 'file', mediaType: 'image/png', url: 'https://example.com/img.png' }))).toBe(
      true
    )
    expect(isRenderablePart(part({ type: 'file', mediaType: 'image/png' }))).toBe(false)
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
