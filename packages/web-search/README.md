# @cherrystudio/web-search

Portable protocols for twelve remote web-search providers. Networking is injected;
no Electron, Node runtime, application settings, or credential storage is included.

```typescript
import { createWebSearchClient } from '@cherrystudio/web-search'
import { tavily } from '@cherrystudio/web-search/providers/tavily'

const client = createWebSearchClient({
  transport: hostTransport,
  providers: [{ provider: tavily, capabilities: ['searchKeywords'] }]
})
const result = await client.execute({
  providerId: 'tavily', capability: 'searchKeywords', input: 'Cherry Studio',
  credentials: { apiKey: selectedKey }, config: { maxResults: 5 }
})
```

Each operation accepts one input. Search always requires a positive safe integer
`maxResults`. Registration capabilities are copied and frozen, and intersected with
the provider's supported capabilities. Duplicate provider ids are rejected.
Credentials are supplied per call, without trimming, rotation, or inheritance.

The transport accepts an already serialized body, returns all HTTP statuses and
complete body text, and supplies lowercase response-header names. It owns deadlines
through body consumption and cleanup. No implicit timeout is applied. `signal` and
`timeoutMs` pass through unchanged; an aborted caller signal preserves its own
reason. Transport adapters classify failures using `WebSearchTransportError`.
Package failures use `WebSearchError` with safe structured details and stable codes.
Native exceptions and response bodies are never copied into package error messages.

| Entry | API |
| --- | --- |
| Root | Client, types, `WebSearchError`, `WebSearchTransportError` |
| `/catalog` | Immutable `webSearchCatalog` |
| `/providers/{id}` | One named provider module; Exa MCP uses `/providers/exa-mcp` and `exaMcp` |
| `/tools/config` | `resolveApiHost`, `mergeApiEndpoint` |
| `/tools/url-filter` | `filterByUrlRules` |
| `/tools/content` | `sliceContent` |

Search is available for Zhipu, Tavily, SearXNG, Exa, Exa MCP, Bocha, Querit, Jina,
Firecrawl, Parallel, and Serply. Fetch is available for Querit, Jina Reader,
Firecrawl scrape, and Crawl4AI. SearXNG and Crawl4AI require a configured host;
other operations have public defaults. Only `undefined` selects a default: an
explicit empty or whitespace host is unconfigured. Jina additionally exports the
immutable `jinaMirrorCandidates` map for global and China search/Reader endpoints.
Hosts choose mirrors, retries, fallback, discovery, enrichment, and budgets.

Bocha always sends `exclude` (empty lists become an empty string); Querit sends
`filters.sites.exclude` only for nonempty lists. No other provider receives domain
exclusions. Only SearXNG receives engines, without discovery. Bocha and Querit rely
on upstream result counts; SearXNG returns every valid HTTP URL with its trimmed raw title and retains
empty snippets so hosts can apply their own limits and enrichment. Search snippets need not contain readable text.

Valid explicit empty search arrays succeed. Missing required result structures,
invalid JSON, and provider failures throw. Empty/whitespace fetch content throws
`invalid_response/empty_content`. Exa MCP intentionally corrects Desktop's existing
contract: explicit successful `result.content: []` means zero hits, while an empty
HTTP body is an error. MCP JSON, finite SSE (including an unterminated final event),
and labeled plain text are supported. Complete SSE events are decoded first;
independent JSON `data:` lines are a fallback for existing single-newline records.
Text paragraphs and both `Text:` and `Highlights:` are retained. Protocol and tool
failures take precedence over success content. Exa MCP page fetch is excluded.

Utilities never run implicitly. URL rules preserve Desktop blacklist semantics,
ignore invalid rules, and keep malformed result URLs. Content slicing applies
characters before tokenx's estimated token boundaries, without ellipsis or a default
budget; zero limits produce empty content, invalid limits throw, and truncation
does not leave a dangling high surrogate. Token estimates are not exact model counts.

ESM, CJS, and explicit React Native resolution conditions cover all 17 entries.
Tokenx is bundled only into the content utility for synchronous CJS compatibility.
`node scripts/check-package.mjs` packs and installs an isolated consumer, verifies
all entries/declarations/export fences, and bundles each entry for browsers.
These checks do not establish Metro or mobile device acceptance.

Version `0.0.0`, MIT license, and Cherry Studio ownership follow the requested
workspace shape pending maintainer confirmation (Issue #21802 DoD 8). Publication,
application integration, CI wiring, and Mobile acceptance are separate tasks.
