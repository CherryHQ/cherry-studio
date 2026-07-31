import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { isHttpUrl } from '@shared/utils/url'

import {
  KB_LIST_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
  kbListStrictInputSchema,
  kbManageInputSchema,
  kbManageStrictInputSchema,
  kbReadInputSchema,
  kbReadStrictInputSchema,
  kbSearchInputSchema,
  REPORT_ARTIFACTS_DESCRIPTION,
  REPORT_ARTIFACTS_TOOL_NAME,
  reportArtifactsInputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webFetchInputSchema
} from '../builtinTools'

function expectDirectPropertyTypes(schema: z.ZodType) {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, { type?: unknown; anyOf?: unknown }>
  }
  const properties = Object.values(json.properties ?? {})

  // Gemini rejects nullable properties because their JSON Schema uses `anyOf` without a top-level
  // `type`. Every strict tool property must therefore serialize as one directly typed primitive.
  expect(properties.every((property) => typeof property.type === 'string')).toBe(true)
  expect(properties.some((property) => property.anyOf !== undefined)).toBe(false)
}

describe('builtin tool contracts', () => {
  it('uses model-facing builtin tool names', () => {
    expect(KB_LIST_TOOL_NAME).toBe('kb_list')
    expect(KB_SEARCH_TOOL_NAME).toBe('kb_search')
    expect(WEB_SEARCH_TOOL_NAME).toBe('web_search')
    expect(WEB_FETCH_TOOL_NAME).toBe('web_fetch')
    expect(REPORT_ARTIFACTS_TOOL_NAME).toBe('report_artifacts')
  })

  it('references the public knowledge list tool name from search input metadata', () => {
    const description = kbSearchInputSchema.shape.baseIds.description

    expect(description).toContain(KB_LIST_TOOL_NAME)
    expect(description).not.toContain('kb__list')
  })

  it('references the public web search tool name from fetch input metadata', () => {
    const description = webFetchInputSchema.shape.urls.description

    expect(description).toContain(WEB_SEARCH_TOOL_NAME)
    expect(description).not.toContain('web__search')
  })

  it('keeps `format` out of the web_fetch schema so strict providers accept it', () => {
    // WebFetchTool runs with `strict: true`. Zod's `.url()` emits `format: "uri"`, which strict
    // OpenAI-compatible providers reject with a 400 that kills the whole request, not just this
    // tool ("Invalid schema for function 'web_fetch': ... 'uri' is not a valid format").
    // The http(s) contract is carried by a refinement, which `toJSONSchema` cannot express.
    // Whole-document rather than a `properties.urls.items.format` chain: an optional chain that
    // stops matching after a shape change would pass while `format` reappeared elsewhere.
    expect(JSON.stringify(z.toJSONSchema(webFetchInputSchema))).not.toContain('"format"')
    expect(webFetchInputSchema.safeParse({ urls: ['https://example.com'] }).success).toBe(true)
  })

  // Dropping `format` must not drop validation: the same schema is what the AI SDK checks a model
  // tool call against. Without this, `example.com` reaches `normalizeWebSearchUrls`, throws, and
  // `classifyWebLookupError` reports it as a *retryable network* error — so the model retries the
  // same bad input instead of being handed a repairable input error.
  it.each([
    ['a bare host', 'example.com'],
    ['a scheme-relative URL', '//example.com'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['prose', 'not a url']
  ])('rejects %s in web_fetch input so the error stays an input error', (_label, url) => {
    expect(webFetchInputSchema.safeParse({ urls: [url] }).success).toBe(false)
  })

  it('still accepts the http(s) forms the model legitimately sends', () => {
    const urls = ['http://example.com', 'https://example.com/a?b=1#c', '  https://example.com/pad  ']

    expect(webFetchInputSchema.safeParse({ urls }).success).toBe(true)
  })

  it('validates web_fetch urls with the same predicate the web search service enforces', () => {
    // The regression this guards against is the schema and the service disagreeing: whatever the
    // schema lets through must also survive `normalizeWebSearchUrls`, or the input error resurfaces
    // downstream as a fetch failure.
    for (const url of ['example.com', 'file:///etc/passwd', 'https://example.com']) {
      expect(webFetchInputSchema.safeParse({ urls: [url] }).success).toBe(isHttpUrl(url))
    }
  })

  it('keeps kb_list strict-path fields in `required` so strict providers accept the schema', () => {
    // AI-SDK strict mode must satisfy both OpenAI-compatible providers (every property required) and
    // Gemini (every property directly typed, with no nullable `anyOf`). Sentinels preserve optional
    // semantics while meeting both contracts.
    const json = z.toJSONSchema(kbListStrictInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(expect.arrayContaining(['query', 'groupId', 'baseId', 'maxDepth']))
    expect(kbListStrictInputSchema.safeParse({ query: '', groupId: '', baseId: '', maxDepth: -1 }).success).toBe(true)
    expectDirectPropertyTypes(kbListStrictInputSchema)
  })

  it('lets the MCP kb_list path omit either filter', () => {
    // The Claude Code bridge parses raw args with kbListInputSchema; an agent may omit filters
    // entirely, so the optional shape must accept `{}` and a lone query without erroring. (Making it
    // required to satisfy the strict path would break this — hence the separate sentinel variant.)
    expect(kbListInputSchema.safeParse({}).success).toBe(true)
    expect(kbListInputSchema.safeParse({ query: 'recipes' }).success).toBe(true)
  })

  it('keeps kb_manage strict-path fields in `required` so strict providers accept the schema', () => {
    // Same cross-provider contract as kb_list. `none`, empty strings, and an empty array represent
    // fields unused by this action and are normalized before the shared mutation core runs.
    const json = z.toJSONSchema(kbManageStrictInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(
      expect.arrayContaining(['baseId', 'action', 'type', 'path', 'url', 'content', 'title', 'conceptIds'])
    )
    expect(
      kbManageStrictInputSchema.safeParse({
        baseId: 'kb-1',
        action: 'delete',
        type: 'none',
        path: '',
        url: '',
        content: '',
        title: '',
        conceptIds: []
      }).success
    ).toBe(true)
    expectDirectPropertyTypes(kbManageStrictInputSchema)
  })

  it('lets the MCP kb_manage path omit unused fields', () => {
    // The Claude Code bridge parses raw args with kbManageInputSchema; an agent may omit every
    // field but `baseId`/`action`, so the optional shape must accept that without erroring.
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'delete' }).success).toBe(true)
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', type: 'note', content: 'hi' }).success).toBe(
      true
    )
  })

  it('keeps kb_read strict-path fields in `required` so strict providers accept the schema', () => {
    const json = z.toJSONSchema(kbReadStrictInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(
      expect.arrayContaining(['baseId', 'conceptId', 'charStart', 'charEnd', 'pattern', 'ignoreCase', 'maxMatches'])
    )
    expect(
      kbReadStrictInputSchema.safeParse({
        baseId: 'kb-1',
        conceptId: 'docs/intro.md',
        charStart: 0,
        charEnd: 0,
        pattern: '',
        ignoreCase: true,
        maxMatches: 0
      }).success
    ).toBe(true)
    expectDirectPropertyTypes(kbReadStrictInputSchema)
  })

  it('lets the MCP kb_read path omit mode-specific fields', () => {
    expect(kbReadInputSchema.safeParse({ baseId: 'kb-1', conceptId: 'docs/intro.md' }).success).toBe(true)
  })

  it('validates final report artifacts', () => {
    const result = reportArtifactsInputSchema.parse({
      artifacts: [{ path: 'dist/report.pdf', description: 'Final report' }],
      summary: 'Generated report'
    })

    expect(result.artifacts[0]).toEqual({ path: 'dist/report.pdf', description: 'Final report' })
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [] }).success).toBe(false)
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [{ path: '   ' }] }).success).toBe(false)
    expect(REPORT_ARTIFACTS_DESCRIPTION).toContain('final deliverable')
  })
})
