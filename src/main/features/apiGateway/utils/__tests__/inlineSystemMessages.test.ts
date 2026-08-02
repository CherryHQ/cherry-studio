import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import {
  hoistSystemMessages,
  keepsSystemMessagesInPlace,
  MID_CONVERSATION_SYSTEM_BETA,
  positionInlineSystemMessages
} from '../inlineSystemMessages'

const betaHeaders = (value: string) => new Headers({ 'anthropic-beta': value })
const AGENT_SDK_BETAS = `claude-code-20250219,interleaved-thinking-2025-05-14,${MID_CONVERSATION_SYSTEM_BETA},effort-2025-11-24`

/**
 * Claude Code 2.1.223's downgrade matcher, read from the binary. Any one clause is
 * enough for it to retry without the beta and sticky-disable it for the session.
 */
const sdkAcceptsAsDowngradeSignal = (status: number, message: string): boolean =>
  status === 400 &&
  ((message.includes(MID_CONVERSATION_SYSTEM_BETA) && message.includes('anthropic-beta')) ||
    (message.includes('Unexpected role') && message.includes('input message role')) ||
    (message.includes('not supported') && /role .{0,2}system/i.test(message)))

/** Every endpoint the gateway can resolve for a chat request. */
const ENDPOINT_CHAT_TARGETS: EndpointType[] = [
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT,
  ENDPOINT_TYPE.OLLAMA_GENERATE,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS
]

const msg = (role: CherryUIMessage['role'], text: string, id: string = role): CherryUIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }]
})

describe('hoistSystemMessages', () => {
  it('merges non-leading system messages into the leading one, preserving order', () => {
    const out = hoistSystemMessages([
      msg('system', 'Base.', 's0'),
      msg('user', 'go'),
      msg('system', 'MCP connecting.', 's1'),
      msg('assistant', 'ok'),
      msg('system', 'Agent types changed.', 's2')
    ])

    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(out[0].parts).toEqual([{ type: 'text', text: 'Base.\n\nMCP connecting.\n\nAgent types changed.' }])
  })

  it('promotes the first inline system message when there is no leading one', () => {
    const out = hoistSystemMessages([msg('user', 'go'), msg('system', 'MCP connecting.')])

    expect(out.map((m) => m.role)).toEqual(['system', 'user'])
    expect(out[0].parts).toEqual([{ type: 'text', text: 'MCP connecting.' }])
  })

  it('returns the input untouched when only a leading system message is present', () => {
    const input = [msg('system', 'Base.'), msg('user', 'go'), msg('assistant', 'ok')]

    expect(hoistSystemMessages(input)).toBe(input)
  })

  it('returns the input untouched when there is no system message at all', () => {
    const input = [msg('user', 'go'), msg('assistant', 'ok')]

    expect(hoistSystemMessages(input)).toBe(input)
  })

  it('drops an empty system message rather than emitting a blank leading turn', () => {
    const out = hoistSystemMessages([msg('user', 'go'), { id: 's', role: 'system', parts: [] }])

    expect(out.map((m) => m.role)).toEqual(['user'])
  })
})

describe('keepsSystemMessagesInPlace', () => {
  it('allows the chat endpoints whose converters were verified to pass a non-leading system through', () => {
    expect(ENDPOINT_CHAT_TARGETS.filter(keepsSystemMessagesInPlace)).toEqual([
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      ENDPOINT_TYPE.OPENAI_RESPONSES
    ])
  })

  it('folds for Gemini and for the completion endpoints whose converters throw', () => {
    expect(keepsSystemMessagesInPlace(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT)).toBe(false)
    expect(keepsSystemMessagesInPlace(ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS)).toBe(false)
    expect(keepsSystemMessagesInPlace(ENDPOINT_TYPE.OLLAMA_GENERATE)).toBe(false)
  })

  it('folds when the endpoint is unknown, so a new endpoint cannot 500', () => {
    expect(keepsSystemMessagesInPlace(undefined)).toBe(false)
    expect(keepsSystemMessagesInPlace('some-endpoint-added-later' as EndpointType)).toBe(false)
  })
})

describe('positionInlineSystemMessages', () => {
  const inline = [msg('system', 'Base.', 's0'), msg('user', 'go'), msg('system', 'MCP connecting.', 's1')]

  it('leaves them in place for a target that accepts them', () => {
    expect(positionInlineSystemMessages(inline, ENDPOINT_TYPE.OPENAI_RESPONSES, betaHeaders(AGENT_SDK_BETAS))).toBe(
      inline
    )
  })

  // An OpenAI-compatible backend whose chat template requires `system` at messages[0]
  // answers a non-leading one with a 400 the Agent SDK does not recognize, so the session
  // fails every turn instead of downgrading. Never send it the shape.
  it('lets the Agent SDK downgrade before sending them to an OpenAI-compatible backend', () => {
    let thrown: unknown
    try {
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, betaHeaders(AGENT_SDK_BETAS))
    } catch (error) {
      thrown = error
    }

    const { status, message } = thrown as Error & { status: number }
    expect(status).toBe(400)
    expect(sdkAcceptsAsDowngradeSignal(status, message)).toBe(true)
  })

  it('folds OpenAI-compatible inline system messages when the client cannot downgrade', () => {
    expect(positionInlineSystemMessages(inline, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, undefined)).toEqual([
      { ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] },
      inline[1]
    ])
  })

  it('rejects with a 400 the Agent SDK downgrades from when the client negotiated the beta', () => {
    let thrown: unknown
    try {
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, betaHeaders(AGENT_SDK_BETAS))
    } catch (error) {
      thrown = error
    }

    const { status, message } = thrown as Error & { status: number }
    expect(status).toBe(400)
    expect(sdkAcceptsAsDowngradeSignal(status, message)).toBe(true)
  })

  it('lets the Agent SDK downgrade inline system messages before sending them to Ollama', () => {
    let thrown: unknown
    try {
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.OLLAMA_CHAT, betaHeaders(AGENT_SDK_BETAS))
    } catch (error) {
      thrown = error
    }

    const { status, message } = thrown as Error & { status: number }
    expect(status).toBe(400)
    expect(sdkAcceptsAsDowngradeSignal(status, message)).toBe(true)
  })

  it('folds instead of rejecting when the client cannot downgrade', () => {
    expect(
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, betaHeaders('claude-code-20250219'))
    ).toEqual([{ ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] }, inline[1]])
  })

  it('folds when there is no anthropic-beta header at all', () => {
    expect(positionInlineSystemMessages(inline, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, undefined)).toHaveLength(2)
  })

  it('folds Ollama inline system messages when the client cannot downgrade', () => {
    expect(positionInlineSystemMessages(inline, ENDPOINT_TYPE.OLLAMA_CHAT, undefined)).toEqual([
      { ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] },
      inline[1]
    ])
  })

  it('never rejects a request that carries no inline system message', () => {
    const plain = [msg('system', 'Base.'), msg('user', 'go')]
    expect(
      positionInlineSystemMessages(plain, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, betaHeaders(AGENT_SDK_BETAS))
    ).toBe(plain)
  })
})
