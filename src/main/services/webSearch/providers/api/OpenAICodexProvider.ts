import { application } from '@application'
import { buildCodexRequestHeaders } from '@main/ai/provider/codex'
import { defaultAppHeaders } from '@main/utils/http'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import {
  buildCodexWebSearchBody,
  CODEX_WEB_SEARCH_RESPONSES_URL,
  parseCodexWebSearchResponse
} from './openaiCodexSearch'

const SEARCH_TIMEOUT_MS = 60_000

/**
 * Web search through the user's ChatGPT subscription (Plus/Pro): the codex
 * responses endpoint with a server-side `web_search` tool. No API key needed —
 * credentials come from the OpenAI Codex OAuth sign-in managed by
 * `OAuthRuntimeService` (the same session the codex chat provider uses).
 */
export class OpenAICodexProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const creds = await application.get('OAuthRuntimeService').getValidAccessToken(OPENAI_CODEX_PROVIDER_ID)
    if (!creds?.accessToken) {
      throw new Error('Not signed in to OpenAI Codex. Open the provider settings and sign in first.')
    }

    const response = await net.fetch(CODEX_WEB_SEARCH_RESPONSES_URL, {
      method: 'POST',
      body: JSON.stringify(
        buildCodexWebSearchBody(query, {
          maxResults: config.maxResults,
          excludeDomains: config.excludeDomains
        })
      ),
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json',
        ...Object.fromEntries(
          buildCodexRequestHeaders(undefined, {
            accessToken: creds.accessToken,
            accountId: creds.accountId ?? null
          }).entries()
        )
      },
      signal: httpOptions?.signal
        ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), httpOptions.signal])
        : AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })

    if (!response.ok) {
      await this.throwHttpError('OpenAI Codex search failed', response)
    }

    const rawText = await response.text()
    const output = parseCodexWebSearchResponse(rawText, config.maxResults)

    if (!output.answer && output.results.length === 0) {
      throw new Error('OpenAI Codex web_search returned no answer or sources')
    }

    return {
      query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [query],
      results: output.results.map((result) => ({
        title: result.title,
        content: result.content,
        url: result.url,
        sourceInput: query
      }))
    }
  }
}
