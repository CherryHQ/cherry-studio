# @cherrystudio/web-search

Portable protocols for the existing Cherry Studio web-search providers. Applications inject
networking and explicitly choose provider capabilities; they keep settings, credential storage,
key rotation, region detection, retries, fallback, local page extraction, and lifecycle ownership.

```ts
import { createWebSearchClient } from '@cherrystudio/web-search'
import { tavily } from '@cherrystudio/web-search/providers/tavily'

const client = createWebSearchClient({
  transport: hostTransport,
  providers: [{ provider: tavily, capabilities: ['searchKeywords'] }]
})

const response = await client.execute({
  providerId: 'tavily',
  capability: 'searchKeywords',
  input: 'Cherry Studio',
  config: { maxResults: 5 },
  credentials: { apiKey: selectedApiKey },
  signal,
  timeoutMs: 30_000
})
```

`hostTransport`, `selectedApiKey`, and `signal` belong to the application. Each call executes one
input against one provider, without implicit retries. Results contain `providerId`, `capability`,
`input`, and `results` with `title`, `url`, `content`, `sourceInput`, and optional `truncated`.

## Entries

| Entry | Contents |
| --- | --- |
| Root | Client, validation, errors, provider vocabulary, and public types |
| `/catalog` | Immutable remote provider metadata and per-capability public endpoints |
| `/providers/<id>` | One protocol module: zhipu, tavily, searxng, exa, exa-mcp, bocha, querit, jina, firecrawl, crawl4ai, parallel, serply, deepseek |
| `/tools/config` | Pure endpoint override merging; explicit empty overrides stay empty |
| `/tools/url-filter` | Optional URL-rule filtering with diagnostics returned to the caller |
| `/tools/content` | Optional token/character slicing; the application allocates total budgets |

Provider entry exports use their ID as the named export, except `exa-mcp`, which exports `exaMcp`.
SearXNG additionally exports `discoverSearxngEngines`; Jina exports `getJinaHostCandidates` and
`JINA_MIRROR_HOSTS`. Importing the root does not import all protocol modules or content slicing.

SearXNG discovery is explicit and uses the same error, cancellation, and timeout contract as
search. Its errors use the `searxng/searchKeywords` context. Search returns snippets and never
automatically downloads result pages. Jina candidate selection is pure; the package does not
detect region or retry another endpoint.

`apiHost: undefined` uses a public default. An explicit empty address fails validation. SearXNG
and Crawl4AI have no default deployment. Local `fetch` and Desktop DuckDuckGo remain host-owned.

Querit accepts API hosts with or without `/v1` and numeric-string response codes. Crawl4AI uses
the Cloud `/scrape` protocol for `crawl4ai.com` and its subdomains, requiring an API key. Other
hosts retain the self-hosted `/md` protocol with an optional token.

## Transport and errors

Implement `WebSearchTransport.request` with the host network stack. Requests contain a complete
URL, headers, an already serialized optional body, `signal`, and optional `timeoutMs`. Return all
HTTP statuses, lowercase response headers, and `bodyText`; do not parse JSON or encode the body
again. Keep URL paths and query encoding intact.

The transport owns timeout enforcement from sending until the body is consumed, forwards
cancellation to the actual request, and releases timers/listeners. Omitting `timeoutMs` retains
host defaults. Throw `WebSearchTransportError` to report network, timeout, cancellation, body-read,
or unclassified failures. An abort without an aborted caller signal is not global cancellation.

`execute` throws `WebSearchError`. Its `kind` distinguishes configuration, network, timeout,
cancellation, HTTP, provider failure, invalid response, and unknown failure. `code`, `status`,
`providerCode`, `retryAfter`, and `requestId` support application policy. `toJSON()` omits causes,
raw responses, headers, and credentials. Cancellations retain the `AbortError` name; timeouts
retain `TimeoutError`. Application-facing messages and retry decisions remain host-owned.

The MCP module supports finite JSON/SSE responses and existing Exa search Text/Highlights and
page text formats. Successful `result.content: []` or the upstream message
`No search results found. Please try a different query.` means zero search hits. Blank or unrecognized responses are errors,
and empty page content is always an error. It does not manage MCP connections, sessions, or
streaming subscriptions.

## Distribution and development

All public entries ship ESM/CJS and matching declarations, including a `react-native` export
condition. The source has no Node, Electron, React Native, Expo, or application imports. Import
resolution checks do not replace consuming-app platform acceptance. Output targets ES2020 and
uses standard `URL`/`URLSearchParams` and the host cancellation signal; networking stays injected.

Desktop consumes `workspace:*` as a development dependency through source aliases, so the portable
implementation is bundled with the application. Its explicit capability profile filters shared metadata.
Mobile must install an exact published version and commit its lockfile. Initial workspace version `0.0.0` is a placeholder; the minor
Changeset prepares `0.1.0`. During 0.x, breaking API changes require a minor release; compatible
fixes use patch releases. Host allowlists prevent new capabilities from being enabled implicitly.

The release workflow explicitly builds and checks this package. `test:package` checks a built
tarball outside the workspace, module formats, declarations, and portable import resolution.

```sh
pnpm --filter @cherrystudio/web-search test -- src/__tests__/protocols.test.ts
pnpm --filter @cherrystudio/web-search test:package
```

These are opt-in development commands. `test:package` includes compilation and network-backed
installation. Follow the current task's authorization rules before running either command.

License: AGPL-3.0-only, preserving the source repository license. Confirm licensing and maintainers
before the initial public release.
