import { createParser } from 'eventsource-parser'
import * as z from 'zod'

import { fail, metadata, prepare, resultSet, send } from '../internal/protocol'
import type { WebSearchProviderModule, WebSearchResult } from '../types'

const envelopeSchema = z.object({
  result: z.object({ content: z.array(z.object({ type: z.string(), text: z.string() })) })
})

function parseItems(text: string, input: string): WebSearchResult[] {
  return text.split(/\r?\n\s*\r?\n(?=Title:|URL:)/).flatMap((chunk) => {
    const title = /^Title:[ \t]*(.*)$/m.exec(chunk)?.[1] || ''
    const url = /^URL:[ \t]*(.*)$/m.exec(chunk)?.[1] || ''
    const fields = [...chunk.matchAll(/^(?:Text|Highlights):[ \t]*(.*(?:\n(?!Text:|Highlights:)[^\n]*)*)/gm)]
    const content = fields
      .map((match) => match[1].trim())
      .filter(Boolean)
      .join('\n\n')
    return title || url || content ? [{ title: title.trim(), url: url.trim(), content, sourceInput: input }] : []
  })
}

function decodePayload(text: string): { text: string; empty: boolean } | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return undefined
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (record.error) {
      const error = record.error as Record<string, unknown>
      return fail('mcp_protocol_error', 'provider', error.code)
    }
    if (record.result && typeof record.result === 'object' && (record.result as Record<string, unknown>).isError)
      return fail('mcp_tool_error', 'provider')
  }
  const parsed = envelopeSchema.safeParse(payload)
  if (!parsed.success) return undefined
  return {
    text: parsed.data.result.content.map((item) => item.text).join('\n\n'),
    empty: parsed.data.result.content.length === 0
  }
}

function parseResponse(body: string, input: string): WebSearchResult[] {
  const texts: string[] = []
  let explicitEmpty = false
  const accept = (text: string): boolean => {
    const decoded = decodePayload(text)
    if (!decoded) return false
    texts.push(decoded.text)
    explicitEmpty ||= decoded.empty
    return true
  }
  if (/^data:/m.test(body)) {
    const parser = createParser({
      onEvent(event) {
        if (accept(event.data)) return
        // Some existing hosts buffer independent JSON records with single-newline separators.
        for (const line of event.data.split('\n')) accept(line)
      }
    })
    parser.feed(`${body}\n\n`)
  } else if (!accept(body) && /^(?:Title|URL|Text|Highlights):/m.test(body)) texts.push(body)
  const results = parseItems(texts.join('\n\n'), input)
  if (!results.length && !explicitEmpty) return fail()
  return results
}

export const exaMcp: WebSearchProviderModule = Object.freeze({
  metadata: metadata('exa-mcp'),
  async execute(request, transport) {
    const { host, key } = prepare(request, exaMcp.metadata)
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: { query: request.input, type: 'auto', numResults: request.config.maxResults, livecrawl: 'fallback' }
      }
    }
    const text = await send(
      request,
      transport,
      host,
      'POST',
      {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(key ? { 'x-api-key': key } : {})
      },
      body
    )
    return resultSet(request, parseResponse(text, request.input).slice(0, request.config.maxResults))
  }
})
