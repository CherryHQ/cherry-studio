import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { isPiToolDisabledByDependency } from '@shared/ai/piBuiltinTools'

import {
  KB_MANAGE_ADD_MAX_ITEMS,
  kbListInputSchema,
  kbManageInputSchema,
  kbReadInputSchema,
  readFileInputSchema,
  reportArtifactsInputSchema,
  webFetchInputSchema
} from '../builtinTools'

describe('builtin tool contracts', () => {
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

  // The kb_* tools run without `strict`, so one optional-shaped schema serves both the AI-SDK tool
  // and the Claude Code / MCP bridge. Every field the chosen mode does not use must be omittable —
  // if any of these regress to required, the model has to invent a value for it.
  it('lets kb_list omit either filter', () => {
    expect(kbListInputSchema.safeParse({}).success).toBe(true)
    expect(kbListInputSchema.safeParse({ query: 'recipes' }).success).toBe(true)
  })

  it('bounds kb_list pages and accepts a continuation cursor', () => {
    expect(kbListInputSchema.parse({ limit: 50, cursor: 'next-page' })).toEqual({
      limit: 50,
      cursor: 'next-page'
    })
    expect(kbListInputSchema.safeParse({ limit: 0 }).success).toBe(false)
  })

  it('lets kb_manage omit the fields its action does not use', () => {
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'delete' }).success).toBe(true)
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', type: 'note', content: 'hi' }).success).toBe(
      true
    )
  })

  // `create` targets no existing base, so `baseId` — required for the item actions — must be
  // omittable there (the core steers when an item action drops it).
  it('lets kb_manage create omit baseId and carry only the name', () => {
    const parsed = kbManageInputSchema.parse({ action: 'create', name: 'Research' })
    expect(parsed.name).toBe('Research')
  })

  it('bounds kb_manage batch items by the shared ingestion cap', () => {
    const item = { type: 'note', content: 'hi' } as const
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', items: [item] }).success).toBe(true)
    expect(
      kbManageInputSchema.safeParse({
        baseId: 'kb-1',
        action: 'add',
        items: Array.from({ length: KB_MANAGE_ADD_MAX_ITEMS + 1 }, () => item)
      }).success
    ).toBe(false)
    expect(kbManageInputSchema.safeParse({ baseId: 'kb-1', action: 'add', items: [] }).success).toBe(false)
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

  it('validates final report artifacts', () => {
    const result = reportArtifactsInputSchema.parse({
      artifacts: [{ path: 'dist/report.pdf', description: 'Final report' }],
      summary: 'Generated report'
    })

    expect(result.artifacts[0]).toEqual({ path: 'dist/report.pdf', description: 'Final report' })
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [] }).success).toBe(false)
    expect(reportArtifactsInputSchema.safeParse({ artifacts: [{ path: '   ' }] }).success).toBe(false)
  })
})

describe('Pi tool dependency policy', () => {
  it('blocks a dependent tool when Pi disabled its shell dependency', () => {
    // Pi stores builtin ids lowercase; the registry declares dependencies in Claude casing.
    expect(isPiToolDisabledByDependency('mcp__cherry-tools__background_task', new Set(['bash']))).toBe(true)
    expect(isPiToolDisabledByDependency('mcp__cherry-tools__background_task', new Set())).toBe(false)
  })

  it('resolves an MCP runtime name through the session metadata', () => {
    const resolveMcpTool = () => ({ name: 'background_task', serverName: 'cherry-tools', serverId: 'server-uuid' })
    expect(isPiToolDisabledByDependency('mcp__server-uuid__background_task', new Set(['bash']), resolveMcpTool)).toBe(
      true
    )
  })
})
