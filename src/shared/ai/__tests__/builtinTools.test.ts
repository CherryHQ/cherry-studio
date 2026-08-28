import { isHttpUrl } from '@shared/utils/url'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
  KB_LIST_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
  kbManageInputSchema,
  kbReadInputSchema,
  kbSearchInputSchema,
  readFileInputSchema,
  REPORT_ARTIFACTS_DESCRIPTION,
  REPORT_ARTIFACTS_TOOL_NAME,
  reportArtifactsInputSchema,
  TO_MARKDOWN_DESCRIPTION,
  TO_MARKDOWN_SUPPORTED_EXTENSIONS,
  toMarkdownInputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webFetchInputSchema
} from '../builtinTools'

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

  it('keeps `format` out of the web_fetch schema so any provider accepts it', () => {
    // Zod's `.url()` emits `format: "uri"`, which strict OpenAI-compatible providers reject with a
    // 400 that kills the whole request, not just this tool ("Invalid schema for function
    // 'web_fetch': ... 'uri' is not a valid format"). No builtin tool is strict any more, but the
    // refinement is kept regardless — `isHttpUrl` is narrower than `.url()` (see the schema).
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

  // The kb_* tools run without `strict`, so one optional-shaped schema serves both the AI-SDK tool
  // and the Claude Code / MCP bridge. Every field the chosen mode does not use must be omittable —
  // if any of these regress to required, the model has to invent a value for it.
  it('lets kb_list omit either filter', () => {
    expect(kbListInputSchema.parse({})).toEqual({ limit: 20 })
    expect(kbListInputSchema.safeParse({ query: 'recipes' }).success).toBe(true)
  })

  it('bounds kb_list pages and accepts a continuation cursor', () => {
    expect(kbListInputSchema.parse({ limit: 50, cursor: 'next-page' })).toEqual({
      limit: 50,
      cursor: 'next-page'
    })
    expect(kbListInputSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(kbListInputSchema.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('lets kb_manage omit the fields its action does not use', () => {
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'delete' }).success).toBe(true)
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', type: 'note', content: 'hi' }).success).toBe(
      true
    )
  })

  it('lets kb_read omit mode-specific fields', () => {
    expect(kbReadInputSchema.safeParse({ baseId: 'kb-1', conceptId: 'docs/intro.md' }).success).toBe(true)
  })

  // `readOrGrepConcept` routes on `pattern` being present at all, so an empty-string `pattern` would
  // mean "grep for ''" rather than "read the document". Rejecting it keeps the sentinel unreachable.
  it('rejects an empty kb_read pattern rather than letting it mean read mode', () => {
    expect(kbReadInputSchema.safeParse({ baseId: 'kb-1', conceptId: 'docs/intro.md', pattern: '' }).success).toBe(false)
  })

  // read_file's offset/limit were required numbers with a 0 sentinel while it ran with `strict: true`.
  // Now that they are plain optionals, `limit: 0` has no sentinel meaning left — and taken literally
  // it says "return zero characters", which `paginate` would answer with a 2-char page. Reject it so
  // a model that still sends the old sentinel gets a repairable input error instead of a silent
  // near-empty read. `offset: 0` stays valid: it genuinely means "start at the beginning".
  it('rejects read_file limit: 0 but keeps offset: 0 meaningful', () => {
    expect(readFileInputSchema.safeParse({ filename: 'a.txt' }).success).toBe(true)
    expect(readFileInputSchema.safeParse({ filename: 'a.txt', offset: 0 }).success).toBe(true)
    expect(readFileInputSchema.safeParse({ filename: 'a.txt', limit: 0 }).success).toBe(false)
    expect(readFileInputSchema.safeParse({ filename: 'a.txt', limit: 1 }).success).toBe(true)
  })

  it('advertises the exact to_markdown input boundary and supported extensions', () => {
    expect(Object.keys(toMarkdownInputSchema.shape)).toEqual(['path'])
    expect(TO_MARKDOWN_SUPPORTED_EXTENSIONS.split(', ')).toEqual([
      '.doc',
      '.docx',
      '.docm',
      '.ppt',
      '.pps',
      '.pot',
      '.pptx',
      '.pptm',
      '.ppsx',
      '.ppsm',
      '.xls',
      '.xlsx',
      '.xlsm',
      '.xlsb',
      '.odt',
      '.ods',
      '.odp',
      '.rtf',
      '.epub',
      '.csv',
      '.pdf'
    ])
    expect(toMarkdownInputSchema.shape.path.description).toContain(TO_MARKDOWN_SUPPORTED_EXTENSIONS)
    // The model must be told the path boundary, not just the formats — it cannot see the guard.
    expect(toMarkdownInputSchema.shape.path.description).toContain('attachment announced with this session')
    expect(toMarkdownInputSchema.shape.path.description).toContain('agent data directory')
    expect(TO_MARKDOWN_DESCRIPTION).toContain(TO_MARKDOWN_SUPPORTED_EXTENSIONS)
    expect(TO_MARKDOWN_DESCRIPTION).toContain('local document')
    expect(TO_MARKDOWN_DESCRIPTION).toContain('OCR')
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
