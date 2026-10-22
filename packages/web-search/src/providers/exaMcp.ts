import { createParser } from 'eventsource-parser'
import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { invalidResponse, protocolError, requestText } from '../protocols/http'
import type { ProtocolContext, WebSearchProviderModule, WebSearchResult } from '../types'

const responseSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  result: z
    .object({
      isError: z.boolean().optional(),
      content: z.array(
        z.object({
          type: z.string(),
          text: z.string().optional()
        })
      )
    })
    .optional()
})

function readTexts(context: ProtocolContext, response: string): { texts: string[]; empty: boolean } {
  const frames: string[] = []
  if (/^data:/m.test(response)) {
    const parser = createParser({
      onEvent: (event) => {
        if (event.data === '[DONE]') return
        try {
          JSON.parse(event.data)
          frames.push(event.data)
        } catch {
          // Older Exa responses put complete JSON frames on adjacent data lines.
          frames.push(...event.data.split('\n').filter((line) => line !== '[DONE]'))
        }
      }
    })
    parser.feed(`${response}\n\n`)
  } else frames.push(response)
  const texts: string[] = []
  let empty = false
  for (const frame of frames) {
    let value: unknown
    try {
      value = JSON.parse(frame)
    } catch {
      continue
    }
    const parsed = responseSchema.safeParse(value)
    if (!parsed.success) continue
    if (parsed.data.error)
      throw protocolError(context, 'provider_error', parsed.data.error.message, String(parsed.data.error.code))
    const result = parsed.data.result
    if (!result) continue
    const content = result.content.flatMap((item) =>
      item.type === 'text' && item.text?.trim() ? [item.text.trim()] : []
    )
    if (result.isError) throw protocolError(context, 'provider_error', content.join('\n') || 'Exa MCP tool failed')
    if (result.content.length === 0) empty = true
    texts.push(...content)
  }
  if (texts.length || empty) return { texts, empty }
  if (response.startsWith('Title:')) return { texts: [response], empty: false }
  throw invalidResponse(context, 'mcp_invalid_response', 'Exa MCP response parsing failed: no parseable content found')
}

function searchResults(raw: string, input: string): WebSearchResult[] {
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\n(?:---\n\n)?(?=Title:[^\n]*\nURL:)/)
    .flatMap((chunk) => {
      const url = /^URL:[ \t]*(https?:\/\/[^\s]+)/m.exec(chunk)?.[1]
      return url
        ? [
            {
              url,
              title: /^Title:[ \t]*([^\n]*)/m.exec(chunk)?.[1]?.trim() || '',
              content: /^(?:Text|Highlights):[ \t]*([\s\S]*)/m.exec(chunk)?.[1]?.trim() || '',
              sourceInput: input
            }
          ]
        : []
    })
}

function pageResults(raw: string, input: string, maxCharacters: number): WebSearchResult[] {
  const match = /^# ([^\n]+)\nURL: (https?:\/\/[^\s]+)\n(?:Published:[^\n]*\n)?(?:Author:[^\n]*\n)?\n([\s\S]*)/.exec(
    raw.replace(/\r\n/g, '\n')
  )
  if (!match?.[3].trim()) return []
  const content = match[3].trim()
  return [
    {
      title: match[1].trim(),
      url: match[2],
      content,
      sourceInput: input,
      ...(content.length >= maxCharacters ? { truncated: true } : {})
    }
  ]
}

export const exaMcp: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['exa-mcp'],
  async execute(context) {
    const { call } = context
    const isSearch = call.capability === 'searchKeywords'
    const args =
      call.capability === 'searchKeywords'
        ? { query: call.input, type: 'auto', numResults: call.config.maxResults, livecrawl: 'fallback' }
        : { urls: [call.input], maxCharacters: call.config.maxCharacters ?? 24_000 }
    const response = await requestText(context, {
      url: context.apiHost,
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(call.credentials?.apiKey ? { 'x-api-key': call.credentials.apiKey } : {})
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: isSearch ? 'web_search_exa' : 'web_fetch_exa', arguments: args }
      })
    })
    const { texts, empty } = readTexts(context, response.bodyText)
    if (call.capability === 'searchKeywords') {
      const results = searchResults(texts.join('\n\n'), call.input).slice(0, call.config.maxResults)
      const noSearchResults =
        texts.length > 0 && texts.every((text) => text === 'No search results found. Please try a different query.')
      if (!results.length && !empty && !noSearchResults)
        throw invalidResponse(context, 'mcp_invalid_response', 'Exa MCP returned no recognizable search results')
      return results
    }
    const results = texts.flatMap((text) => pageResults(text, call.input, call.config.maxCharacters ?? 24_000))
    if (!results.length) throw invalidResponse(context, 'empty_content', 'Exa MCP returned no readable page content')
    return results
  }
}
