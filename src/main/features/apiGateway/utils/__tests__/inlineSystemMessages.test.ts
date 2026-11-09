import { describe, expect, it } from 'vitest'

import type { AppProviderId } from '@main/ai/types'
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

const targets: { endpointType: EndpointType | undefined; aiSdkProviderId: AppProviderId; expected: boolean }[] = [
  { endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, aiSdkProviderId: 'anthropic', expected: true },
  { endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, aiSdkProviderId: 'bedrock', expected: false },
  { endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, aiSdkProviderId: 'google-vertex-anthropic', expected: true },
  { endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, aiSdkProviderId: 'aihubmix', expected: true },
  { endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES, aiSdkProviderId: 'openai', expected: true },
  { endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES, aiSdkProviderId: 'open-responses', expected: true },
  { endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES, aiSdkProviderId: 'azure-responses', expected: true },
  { endpointType: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, aiSdkProviderId: 'google', expected: false },
  { endpointType: ENDPOINT_TYPE.OLLAMA_CHAT, aiSdkProviderId: 'ollama', expected: false },
  { endpointType: ENDPOINT_TYPE.OLLAMA_GENERATE, aiSdkProviderId: 'ollama', expected: false },
  { endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, aiSdkProviderId: 'openai-chat', expected: false },
  { endpointType: ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS, aiSdkProviderId: 'openai', expected: false },
  { endpointType: undefined, aiSdkProviderId: 'anthropic', expected: false },
  { endpointType: 'some-endpoint-added-later' as EndpointType, aiSdkProviderId: 'anthropic', expected: false }
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
  it.each(targets)(
    '$endpointType + $aiSdkProviderId keeps in place: $expected',
    ({ endpointType, aiSdkProviderId, expected }) => {
      expect(keepsSystemMessagesInPlace(endpointType, aiSdkProviderId)).toBe(expected)
    }
  )
})

describe('positionInlineSystemMessages', () => {
  const inline = [msg('system', 'Base.', 's0'), msg('user', 'go'), msg('system', 'MCP connecting.', 's1')]

  it('leaves them in place for a target that accepts them', () => {
    expect(
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai', betaHeaders(AGENT_SDK_BETAS))
    ).toBe(inline)
  })

  // An OpenAI-compatible backend whose chat template requires `system` at messages[0]
  // answers a non-leading one with a 400 the Agent SDK does not recognize, so the session
  // fails every turn instead of downgrading. Never send it the shape.
  it('lets the Agent SDK downgrade before sending them to an OpenAI-compatible backend', () => {
    let thrown: unknown
    try {
      positionInlineSystemMessages(
        inline,
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        'openai-chat',
        betaHeaders(AGENT_SDK_BETAS)
      )
    } catch (error) {
      thrown = error
    }

    const { status, message } = thrown as Error & { status: number }
    expect(status).toBe(400)
    expect(sdkAcceptsAsDowngradeSignal(status, message)).toBe(true)
  })

  it('folds OpenAI-compatible inline system messages when the client cannot downgrade', () => {
    expect(
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai-chat', undefined)
    ).toEqual([{ ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] }, inline[1]])
  })

  it('rejects with a 400 the Agent SDK downgrades from when the client negotiated the beta', () => {
    let thrown: unknown
    try {
      positionInlineSystemMessages(
        inline,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        'google',
        betaHeaders(AGENT_SDK_BETAS)
      )
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
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.OLLAMA_CHAT, 'ollama', betaHeaders(AGENT_SDK_BETAS))
    } catch (error) {
      thrown = error
    }

    const { status, message } = thrown as Error & { status: number }
    expect(status).toBe(400)
    expect(sdkAcceptsAsDowngradeSignal(status, message)).toBe(true)
  })

  it('folds instead of rejecting when the client cannot downgrade', () => {
    expect(
      positionInlineSystemMessages(
        inline,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        'google',
        betaHeaders('claude-code-20250219')
      )
    ).toEqual([{ ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] }, inline[1]])
  })

  it('folds when there is no anthropic-beta header at all', () => {
    expect(
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google', undefined)
    ).toHaveLength(2)
  })

  it('folds Ollama inline system messages when the client cannot downgrade', () => {
    expect(positionInlineSystemMessages(inline, ENDPOINT_TYPE.OLLAMA_CHAT, 'ollama', undefined)).toEqual([
      { ...inline[0], parts: [{ type: 'text', text: 'Base.\n\nMCP connecting.' }] },
      inline[1]
    ])
  })

  it('never rejects a request that carries no inline system message', () => {
    const plain = [msg('system', 'Base.'), msg('user', 'go')]
    expect(
      positionInlineSystemMessages(plain, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google', betaHeaders(AGENT_SDK_BETAS))
    ).toBe(plain)
  })

  it('preserves the inline array reference for the Anthropic adapter', () => {
    expect(
      positionInlineSystemMessages(inline, ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic', betaHeaders(AGENT_SDK_BETAS))
    ).toBe(inline)
  })

  it.each([AGENT_SDK_BETAS, `other-beta,  ${MID_CONVERSATION_SYSTEM_BETA}  ,prompt-caching-scope-2026-01-05`])(
    'rejects negotiated Bedrock inline systems (%s)',
    (betas) => {
      expect(() =>
        positionInlineSystemMessages(inline, ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'bedrock', betaHeaders(betas))
      ).toThrow(
        expect.objectContaining({
          status: 400,
          message: expect.stringContaining('anthropic-beta')
        })
      )
      expect(() =>
        positionInlineSystemMessages(inline, ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'bedrock', betaHeaders(betas))
      ).toThrow(MID_CONVERSATION_SYSTEM_BETA)
    }
  )

  it.each([
    undefined,
    '',
    'unrelated-beta',
    'prompt-caching-scope-2026-01-05',
    'mid-conversation-system-2026-04-08',
    `prefix-${MID_CONVERSATION_SYSTEM_BETA}`
  ])('folds unnegotiated Bedrock inline systems (%s)', (betas) => {
    const output = positionInlineSystemMessages(
      inline,
      ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      'bedrock',
      betas === undefined ? undefined : betaHeaders(betas)
    )
    expect(output.map((message) => message.role)).toEqual(['system', 'user'])
    expect(output[0].parts).toEqual([{ type: 'text', text: 'Base.\n\nMCP connecting.' }])
    expect(output[1]).toBe(inline[1])
    expect(output[1].parts).toEqual([{ type: 'text', text: 'go' }])
  })

  it.each([
    { name: 'empty', messages: [] },
    { name: 'leading system only', messages: [msg('system', 'Base.'), msg('user', 'go')] },
    {
      name: 'leading system prefix',
      messages: [msg('system', 'Base.'), msg('system', 'More context.'), msg('user', 'go')]
    },
    { name: 'no system', messages: [msg('user', 'go')] }
  ])('does not reject Bedrock when the advertised beta is unused ($name)', ({ messages }) => {
    expect(
      positionInlineSystemMessages(messages, ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'bedrock', betaHeaders(AGENT_SDK_BETAS))
    ).toBe(messages)
  })
})
