import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, protocolError, requestJson } from '../protocols/http'
import type { ProtocolContext, WebSearchImageResult, WebSearchProviderModule, WebSearchResult } from '../types'

const searchSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
      content: z.string().optional()
    })
  )
})

const imageSearchSchema = z.looseObject({
  code: z.number(),
  msg: z.string().optional(),
  data: z.looseObject({
    result: z.looseObject({
      block: z.boolean().optional(),
      search_results: z
        .array(
          z.looseObject({
            contentUrl: z.string(),
            snippet: z.string().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
            hostPageUrl: z.string().optional(),
            hostname: z.string().optional()
          })
        )
        .optional()
    })
  })
})

/**
 * StepFun documents `topk` as the upper limit of returned images without a numeric maximum
 * (https://platform.stepfun.com/docs/zh/api-reference/search/search-image), so requests are
 * capped defensively to keep responses bounded.
 */
const STEPFUN_IMAGE_SEARCH_TOPK_MAX = 50

async function searchKeywords(context: ProtocolContext): Promise<readonly WebSearchResult[]> {
  const { call } = context
  if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
  const url = new URL(apiUrl(context.apiHost, 'search'))
  url.pathname = url.pathname.replace(/\/(?:v1\/)?search$/, '/v1/search')
  const payload = await requestJson(
    context,
    {
      url: url.toString(),
      method: 'POST',
      headers: bearer(context),
      body: { query: call.input, n: Math.min(call.config.maxResults, 20) }
    },
    searchSchema
  )
  return payload.results.slice(0, call.config.maxResults).map((item) => ({
    title: item.title,
    url: item.url,
    content: item.content || item.snippet || '',
    sourceInput: call.input
  }))
}

function checkImageSearchError(context: ProtocolContext): (payload: unknown) => void {
  return (payload) => {
    const parsed = z.looseObject({ code: z.number().optional(), msg: z.string().optional() }).safeParse(payload)
    if (!parsed.success || parsed.data.code === undefined || parsed.data.code === 0) return
    throw protocolError(
      context,
      'provider_error',
      parsed.data.msg?.trim() ? parsed.data.msg : 'The provider reported a failure',
      String(parsed.data.code)
    )
  }
}

async function searchImages(context: ProtocolContext): Promise<readonly WebSearchImageResult[]> {
  const { call } = context
  if (call.capability !== 'searchImages') throw new TypeError('Expected image search')
  // The image endpoint is not under /v1; it is resolved from the apiHost origin.
  const url = new URL('/step_plan/v1/search-image', new URL(context.apiHost).origin)
  const payload = await requestJson(
    context,
    {
      url: url.toString(),
      method: 'POST',
      headers: bearer(context),
      body: { query: call.input, topk: Math.min(call.config.maxResults, STEPFUN_IMAGE_SEARCH_TOPK_MAX) }
    },
    imageSearchSchema,
    checkImageSearchError(context)
  )
  const result = payload.data.result
  if (result.block) return []
  return (result.search_results ?? []).slice(0, call.config.maxResults).map((item) => ({
    contentUrl: item.contentUrl,
    snippet: item.snippet ?? '',
    ...(item.width === undefined ? {} : { width: item.width }),
    ...(item.height === undefined ? {} : { height: item.height }),
    ...(item.hostPageUrl === undefined ? {} : { hostPageUrl: item.hostPageUrl }),
    ...(item.hostname === undefined ? {} : { hostname: item.hostname }),
    sourceInput: call.input
  }))
}

export const stepfun: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.stepfun,
  async execute(context) {
    if (context.call.capability === 'searchImages') return searchImages(context)
    return searchKeywords(context)
  }
}
