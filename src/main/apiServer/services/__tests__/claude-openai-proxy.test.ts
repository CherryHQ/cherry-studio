import type { Provider } from '@types'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, getProviderByIdMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getProviderByIdMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@cherrystudio/openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock
      }
    }
  }))
}))

vi.mock('../../utils', () => ({
  getProviderById: getProviderByIdMock
}))

import { type AnthropicMessagesRequest, claudeOpenAIProxyService } from '../claude-openai-proxy'

const provider: Provider = {
  id: 'newapi',
  name: 'NewAPI',
  type: 'new-api',
  apiHost: 'https://newapi.example/v1',
  apiKey: 'key-1',
  enabled: true,
  models: []
}

describe('ClaudeOpenAIProxyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderByIdMock.mockResolvedValue(provider)
  })

  it('converts Anthropic messages requests to OpenAI-compatible chat requests', async () => {
    createMock.mockResolvedValueOnce({
      id: 'chatcmpl-1',
      model: 'gpt-5.5',
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3 }
    })

    const request: AnthropicMessagesRequest = {
      model: 'gpt-5.5',
      max_tokens: 100,
      system: 'You are helpful.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } }
        }
      ]
    }

    const response = await claudeOpenAIProxyService.createMessage('newapi', request)

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        stream: false,
        max_tokens: 100,
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read a file',
              parameters: { type: 'object', properties: { path: { type: 'string' } } }
            }
          }
        ]
      })
    )
    expect(response).toMatchObject({
      type: 'message',
      role: 'assistant',
      model: 'gpt-5.5',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 3 }
    })
  })

  it('streams OpenAI text chunks as Anthropic Messages events', async () => {
    async function* stream() {
      yield { choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }
      yield { choices: [{ delta: { content: 'hel' }, finish_reason: null }] }
      yield {
        choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 2 }
      }
    }

    createMock.mockResolvedValueOnce(stream())
    const writes: string[] = []
    type StreamResponse = Pick<Response, 'writableEnded' | 'destroyed' | 'setHeader' | 'flushHeaders' | 'write' | 'end'>
    const res = {
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
        return true
      }),
      end: vi.fn()
    } satisfies StreamResponse

    await claudeOpenAIProxyService.streamMessage(
      'newapi',
      { model: 'gpt-5.5', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'Hi' }] },
      res as unknown as Response
    )

    const output = writes.join('')
    expect(output).toContain('event: message_start')
    expect(output).toContain('event: content_block_start')
    expect(output).toContain('"text":"hel"')
    expect(output).toContain('"text":"lo"')
    expect(output).toContain('event: message_delta')
    expect(output).toContain('event: message_stop')
    expect(output).toContain('data: [DONE]')
    expect(res.end).toHaveBeenCalled()
  })

  it('rejects providers that are not OpenAI-compatible', async () => {
    getProviderByIdMock.mockResolvedValueOnce({ ...provider, type: 'anthropic' })

    await expect(
      claudeOpenAIProxyService.createMessage('anthropic', {
        model: 'claude-3',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    ).rejects.toThrow("Provider 'newapi' of type 'anthropic' is not OpenAI-compatible")
  })

  it('validates provider before estimating token count', async () => {
    const response = await claudeOpenAIProxyService.countTokens('newapi', {
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'Hello world' }]
    })

    expect(getProviderByIdMock).toHaveBeenCalledWith('newapi')
    expect(response.input_tokens).toBeGreaterThan(0)
  })
})
