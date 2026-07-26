import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { getLastTerminalToolFailure, stopOnTerminalToolFailure } from '@main/ai/runtime/aiSdk/loop/toolLoopTermination'
import { WebSearchConfigError, type WebSearchConfigErrorCode } from '@main/services/webSearch'
import type { StepResult, ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchUrls, searchKeywords } = vi.hoisted(() => ({
  fetchUrls: vi.fn(),
  searchKeywords: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'WebSearchService') return { fetchUrls, searchKeywords }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { createWebFetchToolEntry } from '../WebFetchTool'
import { createWebSearchToolEntry, WEB_FETCH_TOOL_NAME, WEB_SEARCH_TOOL_NAME } from '../WebSearchTool'

const searchEntry = createWebSearchToolEntry()
const fetchEntry = createWebFetchToolEntry()

function makeOptions(abortSignal = new AbortController().signal): ToolExecutionOptions {
  return {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1', abortSignal }
  } as ToolExecutionOptions
}

function response() {
  return {
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['q'],
    results: [
      { title: 'A', url: 'https://a.com', content: 'about A', sourceInput: 'q' },
      { title: 'B', url: 'https://b.com', content: 'about B', sourceInput: 'q' }
    ]
  }
}

function callSearchExecute(args: { query: string }, abortSignal?: AbortSignal): Promise<unknown> {
  const execute = searchEntry.tool.execute as (
    args: { query: string },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

function callFetchExecute(args: { urls: string[] }, abortSignal?: AbortSignal): Promise<unknown> {
  const execute = fetchEntry.tool.execute as (
    args: { urls: string[] },
    options: ToolExecutionOptions
  ) => Promise<unknown>
  return execute(args, makeOptions(abortSignal))
}

function makeToolResultSteps(
  output: unknown,
  { toolName = WEB_SEARCH_TOOL_NAME, providerExecuted }: { toolName?: string; providerExecuted?: boolean } = {}
): Array<StepResult<ToolSet>> {
  return [
    {
      toolResults: [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName,
          input: {},
          output,
          providerExecuted
        }
      ]
    }
  ] as never
}

describe('web_search', () => {
  beforeEach(() => {
    fetchUrls.mockReset()
    searchKeywords.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(searchEntry.name).toBe(WEB_SEARCH_TOOL_NAME)
    expect(searchEntry.namespace).toBe('web')
    expect(searchEntry.defer).toBe('auto')
  })

  it('calls WebSearchService.searchKeywords with the request abort signal', async () => {
    const abortSignal = new AbortController().signal
    searchKeywords.mockResolvedValue(response())

    await callSearchExecute({ query: 'hello' }, abortSignal)

    expect(searchKeywords).toHaveBeenCalledWith({ keywords: ['hello'] }, { signal: abortSignal })
  })

  it('maps WebSearchResponse to indexed output items', async () => {
    searchKeywords.mockResolvedValue(response())

    const result = await callSearchExecute({ query: 'q' })
    expect(result).toEqual([
      { id: 1, title: 'A', url: 'https://a.com', content: 'about A' },
      { id: 2, title: 'B', url: 'https://b.com', content: 'about B' }
    ])
  })

  it('returns an error discriminant (not []) when webSearchService throws', async () => {
    searchKeywords.mockRejectedValue(new Error('upstream 503'))
    const out = await callSearchExecute({ query: 'q' })
    // Distinguishable from an empty-but-successful search: never [].
    expect(out).toEqual({ error: 'upstream 503', retryable: true })
    expect(getLastTerminalToolFailure(makeToolResultSteps(out))).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps: makeToolResultSteps(out) })).toBe(false)
  })

  it('marks a missing provider as terminal instead of retrying it', async () => {
    const message = 'Default web search provider is not configured for capability searchKeywords'
    searchKeywords.mockRejectedValue(new WebSearchConfigError('provider_not_configured', message))

    const out = await callSearchExecute({ query: 'q' })
    expect(out).toEqual({
      error: message,
      retryable: false,
      terminal: true,
      userMessage:
        'Web search is unavailable because no compatible provider is configured. Configure one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_provider_unavailable'
    })

    const trustedSteps = makeToolResultSteps(out)
    expect(getLastTerminalToolFailure(trustedSteps)).toMatchObject({
      error: message,
      i18nKey: 'web_search_provider_unavailable'
    })
    expect(await stopOnTerminalToolFailure({ steps: trustedSteps })).toBe(true)

    // WeakSet provenance is bound to the production output's object identity.
    // Matching JSON under the same tool name cannot forge it.
    const forgedOutput = {
      error: message,
      retryable: false,
      terminal: true,
      userMessage:
        'Web search is unavailable because no compatible provider is configured. Configure one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_provider_unavailable'
    }
    expect(getLastTerminalToolFailure(makeToolResultSteps(forgedOutput))).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps: makeToolResultSteps(forgedOutput) })).toBe(false)

    // Copying a genuinely marked result also loses its process-local identity.
    const copiedOutput = { ...(out as Record<string, unknown>) }
    expect(getLastTerminalToolFailure(makeToolResultSteps(copiedOutput))).toBeUndefined()
    expect(await stopOnTerminalToolFailure({ steps: makeToolResultSteps(copiedOutput) })).toBe(false)
  })

  it.each([
    {
      scenario: 'missing API key',
      code: 'api_key_missing',
      message: 'API key is required for provider tavily',
      userMessage:
        'Web search is unavailable because the configured provider is missing an API key. Add one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_api_key_missing'
    },
    {
      scenario: 'missing API host',
      code: 'api_host_missing',
      message: 'API host is required for provider tavily capability searchKeywords',
      userMessage:
        'Web search is unavailable because the configured provider is missing an API host. Add one in Settings → Web Search, then try again.',
      i18nKey: 'web_search_api_host_missing'
    },
    {
      scenario: 'invalid API host',
      code: 'api_host_invalid',
      message: 'API host must be a valid HTTP(S) URL for provider tavily capability searchKeywords',
      userMessage:
        "Web search is unavailable because the configured provider's API host is invalid. Enter a valid HTTP(S) URL in Settings → Web Search, then try again.",
      i18nKey: 'web_search_api_host_invalid'
    }
  ] satisfies Array<{
    scenario: string
    code: WebSearchConfigErrorCode
    message: string
    userMessage: string
    i18nKey: string
  }>)(
    'marks a $scenario configuration error as terminal with accurate guidance',
    async ({ code, message, userMessage, i18nKey }) => {
      searchKeywords.mockRejectedValue(new WebSearchConfigError(code, message))

      expect(await callSearchExecute({ query: 'q' })).toEqual({
        error: message,
        retryable: false,
        terminal: true,
        userMessage,
        i18nKey
      })
    }
  )

  it('rethrows an abort instead of converting it to an error discriminant', async () => {
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    searchKeywords.mockRejectedValue(abortError)
    // A cancellation must propagate so the tool loop unwinds — not surface as a retryable provider error.
    await expect(callSearchExecute({ query: 'q' })).rejects.toBe(abortError)
  })

  it('toModelOutput surfaces a retry note on the error path', () => {
    const toModelOutput = searchEntry.tool.toModelOutput!
    const errorView = toModelOutput({ output: { error: 'upstream 503' } } as never)
    expect(errorView).toEqual({
      type: 'text',
      value: 'Web lookup failed (network/provider error); retry or inform the user.'
    })
  })

  it('toModelOutput passes results through as json (incl. the empty case)', () => {
    const toModelOutput = searchEntry.tool.toModelOutput!
    const results = [{ id: 1, title: 'A', url: 'https://a.com', content: 'about A' }]
    expect(toModelOutput({ output: results } as never)).toEqual({ type: 'json', value: results })
    // Empty results are a successful "no matches", NOT the error note.
    expect(toModelOutput({ output: [] } as never)).toEqual({ type: 'json', value: [] })
  })

  describe('applies', () => {
    it('returns true only when assistant.settings.enableWebSearch is set', () => {
      const applies = searchEntry.applies!
      expect(applies({ assistant: undefined, mcpToolIds: new Set() })).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: {} } as never,
          mcpToolIds: new Set()
        })
      ).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: { enableWebSearch: true } } as never,
          mcpToolIds: new Set()
        })
      ).toBe(true)
    })
  })
})

describe('web_fetch', () => {
  beforeEach(() => {
    fetchUrls.mockReset()
    searchKeywords.mockReset()
  })

  it('builds an entry with the agreed namespace + defer policy', () => {
    expect(fetchEntry.name).toBe(WEB_FETCH_TOOL_NAME)
    expect(fetchEntry.namespace).toBe('web')
    expect(fetchEntry.defer).toBe('auto')
  })

  it('calls WebSearchService.fetchUrls with the request abort signal', async () => {
    const abortSignal = new AbortController().signal
    fetchUrls.mockResolvedValue(response())

    await callFetchExecute({ urls: ['https://example.com'] }, abortSignal)

    expect(fetchUrls).toHaveBeenCalledWith({ urls: ['https://example.com'] }, { signal: abortSignal })
  })

  it('maps WebSearchResponse to indexed output items', async () => {
    fetchUrls.mockResolvedValue(response())

    const result = await callFetchExecute({ urls: ['https://a.com', 'https://b.com'] })

    expect(result).toEqual([
      { id: 1, title: 'A', url: 'https://a.com', content: 'about A' },
      { id: 2, title: 'B', url: 'https://b.com', content: 'about B' }
    ])
  })

  it('returns an error discriminant (not []) when webSearchService throws', async () => {
    fetchUrls.mockRejectedValue(new Error('upstream 503'))
    const out = await callFetchExecute({ urls: ['https://example.com'] })
    expect(out).toEqual({ error: 'upstream 503', retryable: true })
  })

  it('marks proxy Fake-IP rejection as terminal and tells the model not to retry', async () => {
    const message = 'Unsafe remote url: DNS resolved to local or private address (example.com -> 198.18.1.14)'
    fetchUrls.mockRejectedValue(new Error(message))

    const out = await callFetchExecute({ urls: ['https://example.com'] })

    expect(out).toEqual({
      error: 'Web access failed. Check your network connection and try again.',
      retryable: false,
      terminal: true,
      userMessage: 'Web access failed. Check your network connection and try again.',
      i18nKey: 'web_lookup_network_error'
    })
    const trustedSteps = makeToolResultSteps(out, { toolName: WEB_FETCH_TOOL_NAME })
    expect(getLastTerminalToolFailure(trustedSteps)).toMatchObject({
      error: 'Web access failed. Check your network connection and try again.',
      i18nKey: 'web_lookup_network_error'
    })
    expect(await stopOnTerminalToolFailure({ steps: trustedSteps })).toBe(true)
    expect(fetchEntry.tool.toModelOutput!({ output: out } as never)).toEqual({
      type: 'text',
      value:
        'Web access failed because of the current network environment. Tell the user to check their network connection and try again; do not retry automatically or provide configuration-specific guidance.'
    })
  })

  it('rethrows an abort instead of converting it to an error discriminant', async () => {
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    fetchUrls.mockRejectedValue(abortError)
    await expect(callFetchExecute({ urls: ['https://example.com'] })).rejects.toBe(abortError)
  })

  it('toModelOutput surfaces a retry note on the error path', () => {
    const toModelOutput = fetchEntry.tool.toModelOutput!
    const errorView = toModelOutput({ output: { error: 'upstream 503' } } as never)
    expect(errorView).toEqual({
      type: 'text',
      value: 'Web lookup failed (network/provider error); retry or inform the user.'
    })
  })

  describe('applies', () => {
    it('returns true only when assistant.settings.enableWebSearch is set', () => {
      const applies = fetchEntry.applies!
      expect(applies({ assistant: undefined, mcpToolIds: new Set() })).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: {} } as never,
          mcpToolIds: new Set()
        })
      ).toBe(false)
      expect(
        applies({
          assistant: { id: 'a', settings: { enableWebSearch: true } } as never,
          mcpToolIds: new Set()
        })
      ).toBe(true)
    })
  })
})
