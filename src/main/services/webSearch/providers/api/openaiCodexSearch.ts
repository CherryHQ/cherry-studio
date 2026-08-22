/**
 * Request shaping + streaming response parsing for the OpenAI Codex web search
 * capability — ChatGPT subscription web search via the codex responses
 * endpoint (`chatgpt.com/backend-api/codex/responses`). Kept free of the
 * electron/app import graph so it can be unit-tested directly.
 */

/**
 * The model that runs the server-side `web_search` call and writes the cited
 * summary. Hardcoded to the newest mid-tier ("terra") model in the shipped
 * `openai-codex` provider catalog — the same pick pi-web-access's model
 * preference (mid-tier terra, excluding pro/ultra price tiers) resolves to
 * today. If the catalog changes, revisit: prefer the newest model whose id
 * contains "terra", then the newest bare `gpt-N(.M)` id.
 */
export const CODEX_WEB_SEARCH_MODEL = 'gpt-5.6-terra'

export const CODEX_WEB_SEARCH_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

export interface CodexWebSearchOptions {
  /** Preferred number of distinct sources to return (capped at 20). */
  maxResults?: number
  /** Domains the search must not use. */
  excludeDomains?: string[]
}

export interface CodexWebSearchResult {
  title: string
  content: string
  url: string
}

export interface CodexWebSearchOutput {
  answer: string
  results: CodexWebSearchResult[]
}

function buildInstructions(options: CodexWebSearchOptions): string {
  const lines = [
    'Search the web and return a concise answer grounded only in the web results.',
    'Include clickable source citations in the response text when possible.'
  ]

  if (typeof options.maxResults === 'number' && Number.isFinite(options.maxResults) && options.maxResults > 0) {
    lines.push(`Prefer around ${Math.min(Math.floor(options.maxResults), 20)} distinct sources.`)
  }

  if (options.excludeDomains?.length) {
    lines.push(`Do not use sources from: ${options.excludeDomains.join(', ')}.`)
  }

  return lines.join(' ')
}

/** Build the codex responses request body for a web search call. */
export function buildCodexWebSearchBody(query: string, options: CodexWebSearchOptions = {}): Record<string, unknown> {
  const tool: Record<string, unknown> = { type: 'web_search' }
  if (options.excludeDomains?.length) {
    tool.filters = { blocked_domains: options.excludeDomains }
  }

  return {
    model: CODEX_WEB_SEARCH_MODEL,
    instructions: buildInstructions(options),
    input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
    tools: [tool],
    include: ['web_search_call.action.sources'],
    store: false,
    stream: true,
    tool_choice: 'required',
    parallel_tool_calls: true
  }
}

interface RawSearchResult {
  title: string
  url: string
  content: string
}

function cleanSourceUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    if (url.searchParams.get('utm_source') !== 'openai') return rawUrl
    url.searchParams.delete('utm_source')
    return url.toString()
  } catch {
    return rawUrl.replace(/[?&]utm_source=openai$/, '')
  }
}

function extractSnippetAround(text: string, start: unknown, end: unknown): string {
  if (typeof start !== 'number' || typeof end !== 'number' || !text) return ''
  const before = Math.max(0, start - 100)
  const after = Math.min(text.length, end + 100)
  const snippet = text
    .slice(before, after)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
  return snippet.length > 300 ? `${snippet.slice(0, 297)}...` : snippet
}

function addResult(results: RawSearchResult[], seen: Set<string>, url: unknown, title: unknown, content = ''): void {
  if (typeof url !== 'string' || url.trim().length === 0) return
  const cleanUrl = cleanSourceUrl(url)
  if (seen.has(cleanUrl)) return
  seen.add(cleanUrl)
  results.push({
    title: typeof title === 'string' && title.trim().length > 0 ? title : cleanUrl,
    url: cleanUrl,
    content
  })
}

function extractAnswer(output: unknown[]): string {
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string' && text.trim().length > 0) parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

function extractSearchResults(output: unknown[], maxResults: number | undefined): RawSearchResult[] {
  const results: RawSearchResult[] = []
  const seenUrls = new Set<string>()

  for (const item of output) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''
      const annotations = (part as { annotations?: unknown }).annotations
      if (!Array.isArray(annotations)) continue
      for (const annotation of annotations) {
        if (
          !annotation ||
          typeof annotation !== 'object' ||
          (annotation as { type?: unknown }).type !== 'url_citation'
        ) {
          continue
        }
        addResult(
          results,
          seenUrls,
          (annotation as { url?: unknown }).url,
          (annotation as { title?: unknown }).title,
          extractSnippetAround(
            text,
            (annotation as { start_index?: unknown }).start_index,
            (annotation as { end_index?: unknown }).end_index
          )
        )
      }
    }
  }

  for (const item of output) {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'web_search_call') continue
    const value = item as { action?: unknown; sources?: unknown; results?: unknown }
    const actionSources =
      value.action && typeof value.action === 'object' ? (value.action as { sources?: unknown }).sources : undefined
    for (const group of [actionSources, value.sources, value.results]) {
      if (!Array.isArray(group)) continue
      for (const source of group) {
        if (!source || typeof source !== 'object') continue
        const record = source as Record<string, unknown>
        addResult(results, seenUrls, record.url ?? record.source_website_url, record.title ?? record.caption)
      }
    }
  }

  if (typeof maxResults === 'number' && Number.isFinite(maxResults) && maxResults > 0) {
    return results.slice(0, Math.min(Math.floor(maxResults), 20))
  }
  return results
}

/**
 * Parse a codex responses web search payload — either a single JSON object or
 * an SSE stream of `data:` lines — into the cited answer and source list.
 */
export function parseCodexWebSearchResponse(rawText: string, maxResults?: number): CodexWebSearchOutput {
  const trimmed = rawText.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`OpenAI Codex search returned invalid JSON: ${message}`)
    }
    let output: unknown[]
    if (Array.isArray(parsed)) {
      output = parsed
    } else {
      const record = parsed as Record<string, unknown> | null
      output = record && Array.isArray(record.output) ? record.output : []
    }
    return {
      answer: extractAnswer(output),
      results: extractSearchResults(output, maxResults)
    }
  }

  const outputItems: unknown[] = []
  let completedResponse: Record<string, unknown> | null = null
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (parsed.type === 'response.output_item.done' && parsed.item) outputItems.push(parsed.item)
      if (
        (parsed.type === 'response.done' || parsed.type === 'response.completed') &&
        parsed.response &&
        typeof parsed.response === 'object'
      ) {
        completedResponse = parsed.response as Record<string, unknown>
      }
    } catch {
      // Skip malformed SSE lines; the final response event carries the output.
    }
  }

  let output: unknown[]
  if (completedResponse) {
    output = Array.isArray(completedResponse.output) ? completedResponse.output : []
    if (output.length === 0) output = outputItems
  } else {
    output = outputItems
  }

  return {
    answer: extractAnswer(output),
    results: extractSearchResults(output, maxResults)
  }
}
