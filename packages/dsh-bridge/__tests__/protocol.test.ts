import { describe, expect, it } from 'vitest'

import { createBridgeFrameDecoder, encodeBridgeMessage, type HostToBridgeMessage } from '../src/protocol'

const collect = () => {
  const messages: unknown[] = []
  const decode = createBridgeFrameDecoder((msg) => messages.push(msg))
  return { messages, decode }
}

describe('bridge framing', () => {
  it('round-trips messages coalesced into one chunk', () => {
    const { messages, decode } = collect()
    const a = { type: 'result', id: '1', ok: true }
    const b = { type: 'approvalAsk', id: '2', sessionId: 's', toolName: 'bash' }
    decode(encodeBridgeMessage(a) + encodeBridgeMessage(b))
    expect(messages).toEqual([a, b])
  })

  it('reassembles a message split into arbitrary byte chunks, including mid-multibyte-character', () => {
    const { messages, decode } = collect()
    const msg = { type: 'prompt', id: '1', sessionId: 's', contentBlocks: [{ type: 'text', text: '你好，世界 — ok' }] }
    const bytes = Buffer.from(encodeBridgeMessage(msg), 'utf8')
    for (let i = 0; i < bytes.length; i++) decode(bytes.subarray(i, i + 1))
    expect(messages).toEqual([msg])
  })

  it('holds an incomplete tail frame until its newline arrives', () => {
    const { messages, decode } = collect()
    const msg = { type: 'cancel', id: '9', sessionId: 's' }
    const wire = encodeBridgeMessage(msg)
    decode(wire.slice(0, 5))
    expect(messages).toEqual([])
    decode(wire.slice(5))
    expect(messages).toEqual([msg])
  })

  it('skips blank and malformed lines without dropping later frames', () => {
    const { messages, decode } = collect()
    const msg = { type: 'result', id: '3', ok: false, error: 'x' }
    decode('\n{not json}\n' + encodeBridgeMessage(msg))
    expect(messages).toEqual([msg])
  })

  it('round-trips the host tool catalog and a correlated tool result', () => {
    const { messages, decode } = collect()
    const open: HostToBridgeMessage = {
      type: 'open',
      id: 'open-1',
      sessionId: 's',
      provider: 'deepseek',
      model: 'deepseek-chat',
      cwd: '/tmp/ws',
      resume: false,
      policy: {
        permissionMode: 'default',
        disabledTools: [],
        allowedRoots: ['/tmp/ws'],
        readTools: ['read'],
        editTools: ['edit', 'write'],
        autoApprovedTools: ['mcp__cherry-tools__web_search'],
        approvalRequiredTools: ['mcp__cherry-tools__kb_manage']
      },
      tools: [
        {
          name: 'mcp__cherry-tools__web_search',
          description: 'Searches the web',
          inputSchema: { type: 'object', properties: {} }
        }
      ]
    }
    const result: HostToBridgeMessage = {
      type: 'toolCallResult',
      id: 'tool-1',
      ok: true,
      text: 'done',
      data: { count: 1 }
    }

    decode(encodeBridgeMessage(open) + encodeBridgeMessage(result))

    expect(messages).toEqual([open, result])
  })
})
