import type { ImageBlockParam, MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { asSchema } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { appendInternalAgentContinuation } from '../../utils/agentContinuation'
import { AnthropicMessageConverter, type ReasoningCache } from '../converters/AnthropicMessageConverter'

const converter = new AnthropicMessageConverter()

const params = (overrides: Partial<MessageCreateParams>): MessageCreateParams => ({
  model: 'anthropic:claude',
  max_tokens: 1024,
  messages: [],
  ...overrides
})

const malformedImageBlocks = [
  { name: 'missing source', block: { type: 'image' } },
  { name: 'null source', block: { type: 'image', source: null } },
  { name: 'non-object source', block: { type: 'image', source: 42 } },
  { name: 'missing base64 data', block: { type: 'image', source: { type: 'base64', media_type: 'image/png' } } },
  {
    name: 'null base64 data',
    block: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: null } }
  },
  {
    name: 'numeric base64 data',
    block: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 42 } }
  },
  { name: 'missing url', block: { type: 'image', source: { type: 'url' } } },
  { name: 'null url', block: { type: 'image', source: { type: 'url', url: null } } },
  { name: 'numeric url', block: { type: 'image', source: { type: 'url', url: 42 } } }
]

const malformedMediaTypes = [
  { name: 'missing media_type', field: {} },
  { name: 'null media_type', field: { media_type: null } },
  { name: 'numeric media_type', field: { media_type: 42 } },
  { name: 'blank media_type', field: { media_type: '  ' } },
  { name: 'bare media_type', field: { media_type: 'png' } }
]

const unusableImageSources = [
  { name: 'non-image data URL', source: { type: 'url' as const, url: 'data:text/plain,hello' } },
  { name: 'data URL without a media type', source: { type: 'url' as const, url: 'data:,hello' } },
  { name: 'invalid base64 data URL', source: { type: 'url' as const, url: 'data:image/png;base64,not-valid-base64' } },
  {
    name: 'non-image base64 source',
    source: { type: 'base64' as const, media_type: 'text/plain', data: 'AAAA' } as unknown as ImageBlockParam['source']
  },
  {
    name: 'invalid base64 source',
    source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'not-valid-base64' }
  }
]

describe('AnthropicMessageConverter.toUIMessages', () => {
  it('emits a leading system message from a string system prompt', () => {
    const msgs = converter.toUIMessages(params({ system: 'Be terse.', messages: [{ role: 'user', content: 'hi' }] }))
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'Be terse.' }] })
    expect(msgs[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'hi' }] })
  })

  it('joins a structured (text-block) system prompt', () => {
    const msgs = converter.toUIMessages(
      params({
        system: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' }
        ] as MessageCreateParams['system'],
        messages: [{ role: 'user', content: 'hi' }]
      })
    )
    expect(msgs[0]).toMatchObject({ role: 'system', parts: [{ type: 'text', text: 'A\nB' }] })
  })

  // The Claude Agent SDK ships its harness context (agent/skill catalogs, deferred-tool
  // notices) as `system` messages inside `messages`. Mapping them by position turns them
  // into words the model believes it said.
  it('keeps an inline system message at its own index instead of merging it into a turn', () => {
    const msgs = converter.toUIMessages(
      params({
        system: 'Be terse.',
        messages: [
          { role: 'user', content: 'summarize the doc' },
          { role: 'system', content: 'Available agent types: ...' },
          { role: 'assistant', content: 'On it.' }
        ] as MessageCreateParams['messages']
      })
    )

    expect(msgs.map((msg) => msg.role)).toEqual(['system', 'user', 'system', 'assistant'])
    expect(msgs[0]).toMatchObject({ parts: [{ type: 'text', text: 'Be terse.' }] })
    expect(msgs[2]).toMatchObject({ parts: [{ type: 'text', text: 'Available agent types: ...' }] })
    expect(msgs[3]).toMatchObject({ parts: [{ type: 'text', text: 'On it.' }] })
  })

  // A trailing inline system message left as an assistant turn makes the request look like an
  // assistant prefill, which `appendInternalAgentContinuation` answers by injecting a synthetic
  // "continue with the original user request" turn on any sample where one lands last.
  it('leaves a trailing inline system message out of the assistant tail', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'user', content: 'list the files' },
          { role: 'system', content: [{ type: 'text', text: 'Available agent types: ...' }] }
        ] as MessageCreateParams['messages']
      })
    )

    expect(msgs.map((msg) => msg.role)).toEqual(['user', 'system'])
  })

  it('keeps consecutive inline system messages separate and in arrival order', () => {
    // Harness state changes arrive in bursts while a session warms up — an MCP server
    // connects, skills are discovered, agent types change — each as its own message.
    // Each one appends at the tail, so the prefix before it stays cacheable.
    const msgs = converter.toUIMessages(
      params({
        system: 'Be terse.',
        messages: [
          { role: 'user', content: 'summarize the doc' },
          { role: 'system', content: 'The following MCP servers are still connecting: context' },
          { role: 'system', content: [{ type: 'text', text: 'New agent types are now available.' }] }
        ] as MessageCreateParams['messages']
      })
    )

    expect(msgs.map((msg) => msg.role)).toEqual(['system', 'user', 'system', 'system'])
    expect(msgs[2]).toMatchObject({
      parts: [{ type: 'text', text: 'The following MCP servers are still connecting: context' }]
    })
    expect(msgs[3]).toMatchObject({ parts: [{ type: 'text', text: 'New agent types are now available.' }] })
  })

  it('gives the agent continuation nothing to answer after a mid-session harness update', () => {
    // The reported repeat-reply loop: an `api_system` message arriving at the tail became a
    // text-only assistant turn, which the continuation then answered with a synthetic user
    // turn, making the model redo the original request once per harness update.
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'user', content: 'summarize the doc' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] },
          { role: 'system', content: 'The following MCP servers are still connecting: context' }
        ] as MessageCreateParams['messages']
      })
    )

    expect(appendInternalAgentContinuation(msgs)).toBe(msgs)
  })

  it('converts text + base64 image blocks into text and file parts', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
    ])
  })

  it('accepts base64 image data with whitespace without changing the URL payload', () => {
    const data = ' AQ==\n'
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }
        ]
      })
    )
    expect(msgs[0].parts).toEqual([{ type: 'file', mediaType: 'image/png', url: `data:image/png;base64,${data}` }])
  })

  it.each([
    ['data:image/jpeg;base64,/9j/4AAQ', 'image/jpeg'],
    ['data:image/png,%89PNG', 'image/png']
  ])('keeps a usable image data URL and its declared media type: %s', (url, mediaType) => {
    const msgs = converter.toUIMessages(
      params({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url } }] }] })
    )
    expect(msgs[0].parts).toEqual([{ type: 'file', mediaType, url }])
  })

  it('preserves a valid https image source', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://img.example/x.png' } }] }
        ]
      })
    )
    expect(msgs[0].parts).toEqual([{ type: 'file', mediaType: 'image/png', url: 'https://img.example/x.png' }])
  })

  it('preserves a file URL image source for local inlining', () => {
    const url = 'file:///tmp/image.png'
    const msgs = converter.toUIMessages(
      params({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url } }] }] })
    )
    expect(msgs[0].parts).toEqual([{ type: 'file', mediaType: 'image/png', url }])
  })

  it.each([
    ['HTTPS://img.example/CaseSensitive.PNG?token=AbC', 'https://img.example/CaseSensitive.PNG?token=AbC'],
    ['FILE:///tmp/CaseSensitive.PNG', 'file:///tmp/CaseSensitive.PNG'],
    ['DATA:image/png;base64,AAA', 'data:image/png;base64,AAA']
  ])('accepts %s and lowercases only its scheme', (url, expectedUrl) => {
    const msgs = converter.toUIMessages(
      params({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url } }] }] })
    )
    expect(msgs[0].parts).toEqual([{ type: 'file', mediaType: 'image/png', url: expectedUrl }])
  })

  it.each([
    { type: 'base64' as const, media_type: 'image/png' as const, data: '' },
    { type: 'base64' as const, media_type: 'image/png' as const, data: '  ' },
    { type: 'url' as const, url: '' },
    { type: 'url' as const, url: '  ' },
    { type: 'url' as const, url: 'data:image/png;base64,' },
    { type: 'url' as const, url: 'DATA:image/png;base64,' },
    { type: 'url' as const, url: 'data:image/png' },
    { type: 'url' as const, url: 'ftp://example.com/x.png' }
  ])('replaces an unusable image source with a visible note: %j', (source) => {
    const msgs = converter.toUIMessages(params({ messages: [{ role: 'user', content: [{ type: 'image', source }] }] }))
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: '[image attachment omitted: empty or unsupported image payload]' }
    ])
  })

  it.each(malformedImageBlocks)('omits a top-level image with $name', ({ block }) => {
    const msgs = converter.toUIMessages(
      params({ messages: [{ role: 'user', content: [block] }] as MessageCreateParams['messages'] })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: '[image attachment omitted: empty or unsupported image payload]' }
    ])
  })

  it.each(malformedMediaTypes)('omits a top-level base64 image with $name', ({ field }) => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', data: 'AAAA', ...field } as ImageBlockParam['source'] }
            ]
          }
        ]
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: '[image attachment omitted: empty or unsupported image payload]' }
    ])
  })

  it.each(unusableImageSources)('omits a top-level image with $name', ({ source }) => {
    const msgs = converter.toUIMessages(params({ messages: [{ role: 'user', content: [{ type: 'image', source }] }] }))
    expect(msgs[0].parts).toEqual([
      { type: 'text', text: '[image attachment omitted: empty or unsupported image payload]' }
    ])
  })

  it('maps thinking and redacted_thinking blocks to reasoning parts preserving replay metadata', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hmm', signature: 's' },
              { type: 'redacted_thinking', data: 'xxx' }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )
    // signature/redactedData must survive into providerMetadata — @ai-sdk/anthropic
    // silently drops reasoning parts without them, breaking thinking replay (#18150).
    expect(msgs[0].parts).toEqual([
      { type: 'reasoning', text: 'hmm', providerMetadata: { anthropic: { signature: 's' } } },
      { type: 'reasoning', text: '', providerMetadata: { anthropic: { redactedData: 'xxx' } } }
    ])
  })

  it('preserves an empty thinking signature so the block still replays upstream', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'hmm', signature: '' }]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts).toEqual([
      { type: 'reasoning', text: 'hmm', providerMetadata: { anthropic: { signature: '' } } }
    ])
  })

  it('pairs a tool_use with its later tool_result into an output-available part', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } }]
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '72F' }]
          }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'get_weather',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { city: 'SF' },
      output: '72F'
    })
  })

  it('relocates tool_result images into user file parts and keeps placeholders in the output', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_img', name: 'generate_image', input: {} }]
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_img',
                content: [
                  { type: 'text', text: 'done' },
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
                  { type: 'image', source: { type: 'url', url: 'https://img.example/x.png' } }
                ]
              }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )
    const output = (msgs[0].parts[0] as { output?: unknown }).output
    expect(output).toContain('done')
    expect(output).toContain('[tool-result attachment call_id="call_img" image=1] (image/png)')
    expect(output).toContain('[tool-result attachment call_id="call_img" image=2] (image/png)')
    expect(output).not.toContain('AAAA')
    expect(msgs[1]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: expect.stringContaining('call_id="call_img"') },
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' },
        { type: 'text', text: expect.stringContaining('call_id="call_img"') },
        { type: 'file', mediaType: 'image/png', url: 'https://img.example/x.png' }
      ]
    })
  })

  it('keeps unusable tool_result images visible without claiming they were attached', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_img', name: 'generate_image', input: {} }] },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_img',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
                  { type: 'image', source: { type: 'url', url: '' } }
                ]
              }
            ]
          }
        ]
      })
    )
    const output = (msgs[0].parts[0] as { output: string }).output
    expect(output).toContain('[tool-result attachment call_id="call_img" image=1]')
    expect(output).toContain('[tool-result attachment call_id="call_img" image=2]')
    expect(output).toContain('[image attachment omitted: empty or unsupported image payload]')
    expect(output).not.toContain('attached in the following user message')
    expect(msgs[1].parts).toEqual([
      {
        type: 'text',
        text: '[tool-result attachment call_id="call_img" image=1] [image attachment omitted: empty or unsupported image payload]'
      },
      {
        type: 'text',
        text: '[tool-result attachment call_id="call_img" image=2] [image attachment omitted: empty or unsupported image payload]'
      }
    ])
  })

  it.each(malformedImageBlocks)('omits a tool_result image with $name', ({ block }) => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_img', name: 'generate_image', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_img', content: [block] }] }
        ] as MessageCreateParams['messages']
      })
    )
    const note =
      '[tool-result attachment call_id="call_img" image=1] [image attachment omitted: empty or unsupported image payload]'
    expect((msgs[0].parts[0] as { output: string }).output).toBe(note)
    expect(msgs[1].parts).toEqual([{ type: 'text', text: note }])
  })

  it.each(malformedMediaTypes)('omits a tool_result base64 image with $name', ({ field }) => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_img', name: 'generate_image', input: {} }] },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_img',
                content: [
                  { type: 'image', source: { type: 'base64', data: 'AAAA', ...field } as ImageBlockParam['source'] }
                ]
              }
            ]
          }
        ]
      })
    )
    const note =
      '[tool-result attachment call_id="call_img" image=1] [image attachment omitted: empty or unsupported image payload]'
    expect((msgs[0].parts[0] as { output: string }).output).toBe(note)
    expect(msgs[1].parts).toEqual([{ type: 'text', text: note }])
  })

  it.each(unusableImageSources)('omits a tool_result image with $name', ({ source }) => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'call_img', name: 'generate_image', input: {} }] },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_img', content: [{ type: 'image', source }] }]
          }
        ]
      })
    )
    const note =
      '[tool-result attachment call_id="call_img" image=1] [image attachment omitted: empty or unsupported image payload]'
    expect((msgs[0].parts[0] as { output: string }).output).toBe(note)
    expect(msgs[1].parts).toEqual([{ type: 'text', text: note }])
  })

  it('keeps call ids attached to relocated images when parallel results arrive out of order', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'c1', name: 'generate_image', input: { prompt: 'first' } },
              { type: 'tool_use', id: 'c2', name: 'generate_image', input: { prompt: 'second' } }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'c2',
                content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } }]
              },
              {
                type: 'tool_result',
                tool_use_id: 'c1',
                content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]
              }
            ]
          }
        ] as MessageCreateParams['messages']
      })
    )

    expect((msgs[0].parts[0] as { output?: string }).output).toContain('call_id="c1"')
    expect((msgs[0].parts[1] as { output?: string }).output).toContain('call_id="c2"')
    expect(msgs[1].parts).toEqual([
      { type: 'text', text: expect.stringContaining('call_id="c2"') },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,BBBB' },
      { type: 'text', text: expect.stringContaining('call_id="c1"') },
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }
    ])
  })

  it('emits an input-available tool part when there is no matching result', () => {
    const msgs = converter.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c2', name: 'f', input: {} }] }
        ] as MessageCreateParams['messages']
      })
    )
    expect(msgs[0].parts[0]).toMatchObject({ type: 'dynamic-tool', toolCallId: 'c2', state: 'input-available' })
  })

  // Gateway addresses are `providerId:apiModelId`, and the apiModelId carries a `models/`
  // prefix for some providers but not others — the Gemini 3 check must survive both shapes.
  it.each(['gemini:models/gemini-flash-latest', 'cherryin:gemini-flash-latest', 'gemini:gemini-3-pro-preview'])(
    'restores the cached thought signature for %s',
    (model) => {
      const googleReasoningCache: ReasoningCache = { get: vi.fn(() => 'sig-abc'), set: vi.fn() }
      const c = new AnthropicMessageConverter({ googleReasoningCache })
      const msgs = c.toUIMessages(
        params({
          model,
          messages: [
            { role: 'assistant', content: [{ type: 'tool_use', id: 'c4', name: 'Bash', input: {} }] }
          ] as MessageCreateParams['messages']
        })
      )
      expect(googleReasoningCache.get).toHaveBeenCalledWith('google-c4')
      expect((msgs[0].parts[0] as { callProviderMetadata?: unknown }).callProviderMetadata).toMatchObject({
        google: { thoughtSignature: 'sig-abc' }
      })
    }
  )

  it('leaves the google thought signature off a non-Gemini target', () => {
    const googleReasoningCache: ReasoningCache = { get: vi.fn(() => 'sig-abc'), set: vi.fn() }
    const c = new AnthropicMessageConverter({ googleReasoningCache })
    const msgs = c.toUIMessages(
      params({
        model: 'openai:gpt-5',
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c5', name: 'Bash', input: {} }] }
        ] as MessageCreateParams['messages']
      })
    )
    expect((msgs[0].parts[0] as { callProviderMetadata?: unknown }).callProviderMetadata).toBeUndefined()
  })

  it('reconstructs OpenRouter reasoning_details onto the tool call from the cache', () => {
    const details = [{ type: 'reasoning.text', text: 'because' }]
    const openRouterReasoningCache: ReasoningCache = { get: vi.fn(() => details), set: vi.fn() }
    const c = new AnthropicMessageConverter({ openRouterReasoningCache })
    const msgs = c.toUIMessages(
      params({
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'c3', name: 'f', input: {} }] }
        ] as MessageCreateParams['messages']
      })
    )
    expect(openRouterReasoningCache.get).toHaveBeenCalledWith('openrouter-c3')
    expect((msgs[0].parts[0] as { callProviderMetadata?: unknown }).callProviderMetadata).toMatchObject({
      openrouter: { reasoning_details: details }
    })
  })
})

describe('AnthropicMessageConverter.toAiSdkTools', () => {
  it('builds a ToolSet keyed by name and skips bash tools', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { name: 'get_weather', description: 'w', input_schema: { type: 'object', properties: {} } },
          { type: 'bash_20250124', name: 'bash' }
        ] as MessageCreateParams['tools']
      })
    )
    expect(Object.keys(tools ?? {})).toEqual(['get_weather'])
  })

  it('returns undefined when there are no tools', () => {
    expect(converter.toAiSdkTools(params({}))).toBeUndefined()
  })

  it('drops schema-less server tools and keeps the client tools beside them', () => {
    const tools = converter.toAiSdkTools(
      params({
        tools: [
          { type: 'web_search_20250305', name: 'web_search' },
          { type: 'text_editor_20250124', name: 'str_replace_editor' },
          { name: 'get_weather', description: 'w', input_schema: { type: 'object', properties: {} } }
        ] as never
      })
    )

    expect(Object.keys(tools ?? {})).toEqual(['get_weather'])
  })

  it('returns undefined when every tool is a schema-less server tool', () => {
    // Claude Code's ToolSearch declaration reaches the gateway on every tool-enabled
    // Agent turn; forwarding it to a non-Anthropic provider is not possible (#18643).
    const tools = converter.toAiSdkTools(
      params({ tools: [{ type: 'tool_search_tool_regex_20251119', name: 'tool_search_tool_regex' }] as never })
    )

    expect(tools).toBeUndefined()
  })

  it('normalizes Responses-incompatible names and marks forwarded schemas non-strict', () => {
    const clientToolName = 'mcp__calendar__events.list'
    const request = params({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_1', name: clientToolName, input: {} }]
        }
      ],
      tools: [
        {
          name: clientToolName,
          description: 'List calendar events',
          input_schema: { type: 'object', properties: {}, required: null }
        }
      ] as MessageCreateParams['tools']
    })

    const messages = converter.toUIMessages(request)
    const providerToolName = (messages[0].parts[0] as { toolName: string }).toolName
    const tools = converter.toAiSdkTools(request)
    const forwardedTool = tools?.[providerToolName]

    expect(providerToolName).not.toBe(clientToolName)
    expect(providerToolName).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(forwardedTool?.strict).toBe(false)
    expect((asSchema(forwardedTool!.inputSchema).jsonSchema as { required?: unknown }).required).not.toBeNull()
    expect(converter.toClientToolName(providerToolName)).toBe(clientToolName)
  })
})

describe('AnthropicMessageConverter tool_result media', () => {
  const withToolResult = (content: unknown) =>
    params({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'shot', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content }] }
      ] as MessageCreateParams['messages']
    })

  const toolPartOutput = (p: MessageCreateParams) => {
    const msgs = converter.toUIMessages(p)
    const part = msgs.flatMap((m) => m.parts).find((x) => x.type === 'dynamic-tool') as { output?: unknown }
    return part.output
  }

  // A nested tool_result image never rides inside the tool output — it is relocated into
  // the carrying user message as a `file` part (covered by the relocation tests above),
  // so the output keeps only text plus the anchor placeholder.
  it('keeps the base64 payload out of the tool output when an image is relocated', () => {
    const output = toolPartOutput(
      withToolResult([
        { type: 'text', text: 'here' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
      ])
    )
    expect(typeof output).toBe('string')
    expect(output as string).toContain('here')
    expect(output as string).not.toContain('AAAA')
    expect(output as string).not.toContain('data:image/png;base64')
  })

  it('keeps a text-only tool_result as a joined string (unchanged)', () => {
    expect(
      toolPartOutput(
        withToolResult([
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ])
      )
    ).toBe('a\nb')
  })
})

describe('AnthropicMessageConverter.extractStreamOptions', () => {
  it('maps Anthropic sampling params to common options', () => {
    expect(
      converter.extractStreamOptions(
        params({ max_tokens: 256, temperature: 0.5, top_p: 0.9, top_k: 40, stop_sequences: ['x'] })
      )
    ).toEqual({ maxOutputTokens: 256, temperature: 0.5, topP: 0.9, topK: 40, stopSequences: ['x'] })
  })
})
