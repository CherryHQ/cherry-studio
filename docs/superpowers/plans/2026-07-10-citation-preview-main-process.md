# Citation Preview Main Process Migration Implementation Plan

> **For the AI agent implementing this plan:** Required sub-skill: use `superpowers-zh:test-driven-development` for each task. Use `superpowers-zh:subagent-driven-development` (recommended) or `superpowers-zh:executing-plans` to execute the tasks and track every checkbox.

**Goal:** Move ordinary webpage citation preview fetch/parse work out of the renderer and behind the narrow `citation.fetch_preview` IpcApi route so opening the citations panel cannot block the renderer on large or slow pages.

**Architecture:** `CitationsList` remains the sole consumer and keeps SWR as the completed-result cache. A citation-specific main utility validates the remote URL, limits concurrency and response size, fetches through Electron `net.fetch`, extracts readable text, cleans and truncates it, and shares same-URL in-flight work. The IpcApi handler returns `{ content: '' }` for operational failures; it does not depend on WebSearch provider configuration or expose a provider override.

**Tech Stack:** TypeScript, Electron `net.fetch`, IpcApi + Zod, `p-queue`, JSDOM + Mozilla Readability, React + SWR, Vitest + Testing Library.

**Verification constraint:** Do not run `pnpm test` or `pnpm build:check`; both execute the full test suite. Run only the focused main/renderer Vitest files listed below, plus repository lint, format, type checks, and documentation link checks. Do not create commits in this execution because repository policy requires `pnpm build:check` before every commit.

---

## Scope Guard

In scope:

- Ordinary non-X `websearch` citations in `CitationsList`.
- One URL per `citation.fetch_preview` request.
- A cleaned, display-ready preview string only.
- Main-side URL safety, timeout, content-type/size guards, concurrency, and same-URL in-flight sharing.

Out of scope:

- `CitationTooltip` behavior.
- X/Twitter oEmbed migration or deduplication changes.
- `web_search.fetch_urls`, `WebSearchService`, provider defaults, API keys, quotas, or provider selection.
- Main-side completed-result TTL caching.
- Renderer-to-main cancellation.
- New lifecycle or direct-import service classes.
- Pre-existing unused `fetchRedirectUrl`; leave it unchanged.

## File Map

Create:

- `src/shared/ipc/schemas/citation.ts` - single-route input/output contract.
- `src/main/ipc/handlers/citation.ts` - thin failure-normalizing IpcApi adapter.
- `src/main/ipc/handlers/__tests__/citation.test.ts` - handler delegation and fallback tests.
- `src/main/utils/citationPreview.ts` - safe bounded fetch, parse, cleanup, queue, and in-flight sharing.
- `src/main/utils/__tests__/citationPreview.test.ts` - utility behavior, safety, and concurrency tests.

Modify:

- `src/shared/ipc/schemas/ipcSchemas.ts` - register `citationRequestSchemas`.
- `src/main/ipc/handlers/ipcHandlers.ts` - register `citationHandlers`.
- `src/renderer/components/chat/messages/blocks/CitationsList.tsx` - call `citation.fetch_preview` for ordinary web citations.
- `src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx` - pin IPC use, empty fallback, X behavior, and SWR deduplication.
- `src/renderer/utils/fetch.ts` - remove renderer-only ordinary webpage fetch/parser exports orphaned by the migration.
- `src/renderer/utils/__tests__/fetch.test.ts` - remove tests/mocks for deleted exports while retaining redirect helper coverage.

Do not modify:

- `src/renderer/components/chat/messages/markdown/CitationTooltip.tsx`.
- `src/renderer/components/chat/messages/markdown/__tests__/CitationTooltip.test.tsx`.
- `src/shared/ipc/schemas/webSearch.ts`.
- `src/main/ipc/handlers/webSearch.ts`.
- `src/main/services/webSearch/**`.

### Task 1: Implement the bounded main-process preview utility with TDD

**Files:**

- Create: `src/main/utils/__tests__/citationPreview.test.ts`
- Create: `src/main/utils/citationPreview.ts`
- Reference: `src/main/utils/remoteUrlSafety.ts`
- Reference: `src/main/features/knowledge/utils/sources/url.ts`
- Reference: `src/main/features/knowledge/utils/sources/__tests__/url.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create tests that use real `Response` objects and mock only Electron `net.fetch`. Reset modules before each test so the module-level queue and in-flight map are isolated.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ netFetch: vi.fn() }))

vi.mock('electron', () => ({ net: { fetch: mocks.netFetch } }))

import type * as CitationPreviewModule from '../citationPreview'

let fetchCitationPreview: typeof CitationPreviewModule.fetchCitationPreview

const textResponse = (content: string, headers: HeadersInit = { 'content-type': 'text/plain' }) =>
  new Response(content, { status: 200, headers })

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  ;({ fetchCitationPreview } = await import('../citationPreview'))
})

describe('fetchCitationPreview', () => {
  it('returns cleaned and truncated text', async () => {
    mocks.netFetch.mockResolvedValue(textResponse(`[Docs](https://example.com) ${'a'.repeat(120)}`))

    const content = await fetchCitationPreview('https://example.com/article')

    expect(content.startsWith('Docs ')).toBe(true)
    expect(content.endsWith('...')).toBe(true)
    expect(content.length).toBe(103)
  })

  it('extracts readable text from HTML', async () => {
    const paragraph = 'Readable citation content '.repeat(20)
    mocks.netFetch.mockResolvedValue(
      textResponse(`<html><body><article><h1>Title</h1><p>${paragraph}</p></article></body></html>`, {
        'content-type': 'text/html; charset=utf-8'
      })
    )

    await expect(fetchCitationPreview('https://example.com/article')).resolves.toContain('Readable citation content')
  })

  it('returns empty content for private addresses without fetching', async () => {
    await expect(fetchCitationPreview('http://127.0.0.1/metadata')).resolves.toBe('')
    expect(mocks.netFetch).not.toHaveBeenCalled()
  })

  it('returns empty content for non-text responses', async () => {
    mocks.netFetch.mockResolvedValue(textResponse('binary', { 'content-type': 'image/png' }))

    await expect(fetchCitationPreview('https://example.com/image.png')).resolves.toBe('')
  })

  it('rejects a declared response larger than one megabyte before reading', async () => {
    mocks.netFetch.mockResolvedValue(
      textResponse('ignored', {
        'content-type': 'text/plain',
        'content-length': String(1024 * 1024 + 1)
      })
    )

    await expect(fetchCitationPreview('https://example.com/large')).resolves.toBe('')
  })

  it('stops reading an undeclared response after one megabyte', async () => {
    mocks.netFetch.mockResolvedValue(textResponse('x'.repeat(1024 * 1024 + 1)))

    await expect(fetchCitationPreview('https://example.com/chunked')).resolves.toBe('')
  })

  it('shares one in-flight promise for the same normalized URL', async () => {
    let resolveFetch!: (response: Response) => void
    mocks.netFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    )

    const first = fetchCitationPreview('https://example.com/article')
    const second = fetchCitationPreview('https://example.com/article')

    expect(second).toBe(first)
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(1))

    resolveFetch(textResponse('preview'))
    await expect(first).resolves.toBe('preview')
  })

  it('runs at most three fetches and creates timeouts only after dequeue', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const releases: Array<() => void> = []
    mocks.netFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(textResponse('preview')))
        })
    )

    const requests = [1, 2, 3, 4].map((id) => fetchCitationPreview(`https://example.com/${id}`))

    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(3))
    expect(timeoutSpy).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenCalledWith(8000)

    releases[0]()
    await vi.waitFor(() => expect(mocks.netFetch).toHaveBeenCalledTimes(4))
    expect(timeoutSpy).toHaveBeenCalledTimes(4)

    releases.slice(1).forEach((release) => release())
    await expect(Promise.all(requests)).resolves.toEqual(['preview', 'preview', 'preview', 'preview'])
    timeoutSpy.mockRestore()
  })

  it('returns empty content for network and HTTP failures', async () => {
    mocks.netFetch.mockRejectedValueOnce(new Error('network down'))
    await expect(fetchCitationPreview('https://example.com/network')).resolves.toBe('')

    mocks.netFetch.mockResolvedValueOnce(new Response('', { status: 500, headers: { 'content-type': 'text/html' } }))
    await expect(fetchCitationPreview('https://example.com/http')).resolves.toBe('')
  })
})
```

- [ ] **Step 2: Run the utility test and confirm the expected failure**

Run:

```bash
pnpm exec vitest run --project main src/main/utils/__tests__/citationPreview.test.ts
```

Expected: FAIL because `src/main/utils/citationPreview.ts` does not exist.

- [ ] **Step 3: Implement the minimum citation preview utility**

Create `src/main/utils/citationPreview.ts` with these fixed policies: concurrency 3, timeout 8 seconds created inside the queue task, one-megabyte streamed body limit, same-URL in-flight sharing, HTML/text only, and 100 characters plus `...` when truncated.

```ts
import { loggerService } from '@logger'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { Readability } from '@mozilla/readability'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import PQueue from 'p-queue'

const logger = loggerService.withContext('CitationPreview')
const citationPreviewQueue = new PQueue({ concurrency: 3 })
const inFlightPreviews = new Map<string, Promise<string>>()

const FETCH_TIMEOUT_MS = 8000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_PREVIEW_LENGTH = 100
const SAFE_JSDOM_URL = 'http://localhost/'

const requestHeaders = new Headers({
  Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

function getMediaType(response: Response) {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
}

function isHtmlMediaType(mediaType: string) {
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
}

function isSupportedMediaType(mediaType: string) {
  return isHtmlMediaType(mediaType) || mediaType.startsWith('text/')
}

async function readLimitedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const length = Number(declaredLength)
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) return ''
  }

  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let byteLength = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return ''
      }

      text += decoder.decode(value, { stream: true })
    }

    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function extractReadableText(html: string) {
  const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })
  try {
    return new Readability(dom.window.document).parse()?.textContent ?? ''
  } finally {
    dom.window.close()
  }
}

function buildPreview(text: string) {
  const cleaned = text
    .replace(/!\[.*?]\(.*?\)/g, '')
    .replace(/\[(.*?)]\(.*?\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[-—–_=+]{3,}/g, ' ')
    .replace(/[￥$€£¥%@#&*^()[\]{}<>~`'"\\|/_.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > MAX_PREVIEW_LENGTH ? `${cleaned.slice(0, MAX_PREVIEW_LENGTH)}...` : cleaned
}

async function loadCitationPreview(safeUrl: string): Promise<string> {
  try {
    const response = await net.fetch(safeUrl, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return ''

    const mediaType = getMediaType(response)
    if (!isSupportedMediaType(mediaType)) return ''

    const body = await readLimitedText(response)
    if (!body) return ''

    return buildPreview(isHtmlMediaType(mediaType) ? extractReadableText(body) : body)
  } catch (error) {
    logger.warn('Failed to fetch citation preview', error as Error)
    return ''
  }
}

export function fetchCitationPreview(url: string): Promise<string> {
  let safeUrl: string
  try {
    safeUrl = sanitizeRemoteUrl(url)
  } catch {
    return Promise.resolve('')
  }

  const existing = inFlightPreviews.get(safeUrl)
  if (existing) return existing

  const pending = citationPreviewQueue.add(() => loadCitationPreview(safeUrl)).then((content) => content ?? '')
  inFlightPreviews.set(safeUrl, pending)

  void pending.then(
    () => {
      if (inFlightPreviews.get(safeUrl) === pending) inFlightPreviews.delete(safeUrl)
    },
    () => {
      if (inFlightPreviews.get(safeUrl) === pending) inFlightPreviews.delete(safeUrl)
    }
  )

  return pending
}
```

- [ ] **Step 4: Run the utility test and confirm it passes**

Run:

```bash
pnpm exec vitest run --project main src/main/utils/__tests__/citationPreview.test.ts
```

Expected: PASS with nine utility tests, including the real Readability HTML fixture.

### Task 2: Add the narrow `citation.fetch_preview` IpcApi route with TDD

**Files:**

- Create: `src/shared/ipc/schemas/citation.ts`
- Create: `src/main/ipc/handlers/__tests__/citation.test.ts`
- Create: `src/main/ipc/handlers/citation.ts`
- Modify: `src/shared/ipc/schemas/ipcSchemas.ts`
- Modify: `src/main/ipc/handlers/ipcHandlers.ts`

- [ ] **Step 1: Declare the route schema**

Create `src/shared/ipc/schemas/citation.ts`. Do not add schema unit tests.

```ts
import * as z from 'zod'

import { defineRoute } from '../define'

export const citationRequestSchemas = {
  'citation.fetch_preview': defineRoute({
    input: z.object({ url: z.url() }),
    output: z.object({ content: z.string() })
  })
}
```

- [ ] **Step 2: Write the failing handler tests**

Create `src/main/ipc/handlers/__tests__/citation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchCitationPreview: vi.fn() }))

vi.mock('@main/utils/citationPreview', () => ({ fetchCitationPreview: mocks.fetchCitationPreview }))

import { citationHandlers } from '../citation'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('citationHandlers', () => {
  it('forwards one URL and returns only preview content', async () => {
    mocks.fetchCitationPreview.mockResolvedValue('Short preview')
    const fetchPreview = citationHandlers['citation.fetch_preview']

    await expect(fetchPreview({ url: 'https://example.com/article' }, ctx)).resolves.toEqual({
      content: 'Short preview'
    })
    expect(mocks.fetchCitationPreview).toHaveBeenCalledWith('https://example.com/article')
  })

  it('normalizes utility failures to empty content', async () => {
    mocks.fetchCitationPreview.mockRejectedValue(new Error('unexpected failure'))
    const fetchPreview = citationHandlers['citation.fetch_preview']

    await expect(fetchPreview({ url: 'https://example.com/article' }, ctx)).resolves.toEqual({ content: '' })
  })
})
```

- [ ] **Step 3: Run the handler test and confirm the expected failure**

Run:

```bash
pnpm exec vitest run --project main src/main/ipc/handlers/__tests__/citation.test.ts
```

Expected: FAIL because `src/main/ipc/handlers/citation.ts` does not exist.

- [ ] **Step 4: Implement the thin handler**

Create `src/main/ipc/handlers/citation.ts`:

```ts
import { fetchCitationPreview } from '@main/utils/citationPreview'
import type { citationRequestSchemas } from '@shared/ipc/schemas/citation'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const citationHandlers: IpcHandlersFor<typeof citationRequestSchemas> = {
  'citation.fetch_preview': async ({ url }) => {
    try {
      return { content: await fetchCitationPreview(url) }
    } catch {
      return { content: '' }
    }
  }
}
```

- [ ] **Step 5: Register the schema and handler in the audited registries**

Apply these two insertions to `src/shared/ipc/schemas/ipcSchemas.ts`:

```diff
 import { type BinaryEventSchemas, binaryRequestSchemas } from './binary'
 import { cherryinRequestSchemas } from './cherryin'
+import { citationRequestSchemas } from './citation'
 import { fileRequestSchemas } from './file'

-  ...cherryinRequestSchemas,
-  ...fileRequestSchemas,
+  ...cherryinRequestSchemas,
+  ...citationRequestSchemas,
+  ...fileRequestSchemas,
```

Apply the matching two insertions to `src/main/ipc/handlers/ipcHandlers.ts`:

```diff
 import { binaryHandlers } from './binary'
 import { cherryinHandlers } from './cherryin'
+import { citationHandlers } from './citation'
 import { fileHandlers } from './file'

-  ...cherryinHandlers,
-  ...fileHandlers,
+  ...cherryinHandlers,
+  ...citationHandlers,
+  ...fileHandlers,
```

Do not change the ordering or contents of the other domain imports and spreads.

- [ ] **Step 6: Run both focused main tests**

Run:

```bash
pnpm exec vitest run --project main \
  src/main/utils/__tests__/citationPreview.test.ts \
  src/main/ipc/handlers/__tests__/citation.test.ts
```

Expected: PASS. No `webSearch` test should need changes.

### Task 3: Switch ordinary citation previews to IpcApi with component TDD

**Files:**

- Modify: `src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx`
- Modify: `src/renderer/components/chat/messages/blocks/CitationsList.tsx`

- [ ] **Step 1: Replace the ordinary web fetch mock with an IpcApi mock**

In `CitationsList.test.tsx`, make these exact mock changes:

```diff
const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  openCitationsPanel: vi.fn(),
  copyText: vi.fn(),
  notifyError: vi.fn(),
  messageListActions: undefined as
    | {
        openCitationsPanel?: ReturnType<typeof vi.fn>
        copyText?: ReturnType<typeof vi.fn>
        notifyError?: ReturnType<typeof vi.fn>
      }
    | undefined
}))

const fetchMocks = vi.hoisted(() => ({
-  fetchWebContent: vi.fn(),
  fetchXOEmbed: vi.fn(),
  isXPostUrl: vi.fn()
}))

+vi.mock('@renderer/ipc', () => ({
+  ipcApi: { request: mocks.ipcRequest }
+}))

 vi.mock('@renderer/utils/fetch', () => ({
-  fetchWebContent: fetchMocks.fetchWebContent,
   fetchXOEmbed: fetchMocks.fetchXOEmbed,
   isXPostUrl: fetchMocks.isXPostUrl,
-  noContent: 'No content found',
   xOembedKey: (url: string) => `xOembed/${url}`
 }))
```

In `beforeEach`, replace the `fetchWebContent` default with:

```ts
mocks.ipcRequest.mockResolvedValue({ content: 'Fetched citation preview' })
```

Update the remaining pre-existing assertions as follows so no deleted mock is referenced:

| Existing test | Exact adjustment |
|---|---|
| `lets the panel content fill the side panel body` | Wait for `mocks.ipcRequest` instead of `fetchMocks.fetchWebContent`. |
| `opens panel web citations through the supplied external URL action` | Keep the action assertions; wait for `mocks.ipcRequest`. |
| `renders web citations without a url as non-links` | Assert `mocks.ipcRequest` was not called. |
| `renders the fetched web-content preview snippet` | Rename to `renders the citation preview returned by main` and expect `Fetched citation preview`. |
| `hides the preview snippet when web-content fetch degrades to noContent` | Rename to `hides the preview snippet when main returns empty content`; mock `{ content: '' }`. |
| `copies the truncated preview snippet, not the full content` | Rename to `copies the display-ready preview returned by main`; mock `{ content: `${'A'.repeat(100)}...` }` and assert the copied string equals that value. |
| `dedupes web-content fetches for the same URL via the shared SWR cache` | Rename to the IPC/SWR wording below and assert `mocks.ipcRequest` was called once. |

The four behavior tests below replace the old ordinary-fetch/degrade/dedupe tests and add the X boundary guard.

- [ ] **Step 2: Update the affected component tests before the implementation**

Replace the ordinary-web expectations with these behaviors while keeping unrelated rendering/action tests intact:

```ts
it('fetches an ordinary web citation through citation.fetch_preview', async () => {
  const citations: Citation[] = [
    { number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }
  ]

  render(<CitationsPanelContent citations={citations} />, { wrapper })

  await screen.findByText('Fetched citation preview')
  expect(mocks.ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', {
    url: 'https://example.com'
  })
  expect(fetchMocks.fetchXOEmbed).not.toHaveBeenCalled()
})

it('hides the snippet when the citation preview is empty', async () => {
  mocks.ipcRequest.mockResolvedValue({ content: '' })
  const citations: Citation[] = [
    { number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }
  ]

  render(<CitationsPanelContent citations={citations} />, { wrapper })

  await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('link', { name: 'Example' })).toBeInTheDocument()
  expect(screen.queryByText('Fetched citation preview')).not.toBeInTheDocument()
})

it('keeps X citations on the renderer oEmbed path', async () => {
  fetchMocks.isXPostUrl.mockReturnValue(true)
  fetchMocks.fetchXOEmbed.mockResolvedValue({ author: 'author', text: 'post text' })
  const citations: Citation[] = [
    { number: 1, url: 'https://x.com/author/status/1', title: 'Post', type: 'websearch' }
  ]

  render(<CitationsPanelContent citations={citations} />, { wrapper })

  await screen.findByText('@author: post text')
  expect(fetchMocks.fetchXOEmbed).toHaveBeenCalled()
  expect(mocks.ipcRequest).not.toHaveBeenCalled()
})

it('dedupes ordinary citation preview IPC requests for the same URL through SWR', async () => {
  const a: Citation = { number: 1, url: 'https://dup.com', title: 'A', type: 'websearch' }
  const b: Citation = { number: 2, url: 'https://dup.com', title: 'B', type: 'websearch' }

  render(
    <>
      <CitationsPanelContent citations={[a]} />
      <CitationsPanelContent citations={[b]} />
    </>,
    { wrapper }
  )

  await screen.findAllByText('Fetched citation preview')
  expect(mocks.ipcRequest).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run the component test and confirm it fails against the old renderer fetch path**

Run:

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx
```

Expected: FAIL because `CitationsList` still calls `fetchWebContent` and does not call `ipcApi.request`.

- [ ] **Step 4: Replace only the ordinary web branch in `CitationsList`**

Change imports in `CitationsList.tsx`:

```ts
import { ipcApi } from '@renderer/ipc'
import { fetchXOEmbed, isXPostUrl, xOembedKey } from '@renderer/utils/fetch'
import React from 'react'
```

Remove `cleanMarkdownContent`, `useMemo`, and the local `truncateText` helper. Replace the ordinary fetch block while preserving the X branch and its second oEmbed SWR call:

```ts
const { data: fetchedContent, isLoading } = useSWRImmutable(
  citation.url ? (isXPost ? `webContent/${citation.url}` : `citationPreview/${citation.url}`) : null,
  async () => {
    if (isXPost) {
      const oembed = await fetchXOEmbed(citation.url)
      return oembed ? `@${oembed.author}: ${oembed.text}` : ''
    }

    const { content } = await ipcApi.request('citation.fetch_preview', { url: citation.url })
    return content
  },
  { shouldRetryOnError: false }
)
```

Leave the skeleton and `fetchedContent && ...` rendering unchanged. An empty string therefore renders title/link only, and IpcApi framework rejections remain silent because SWR retries are disabled and the component does not render its error.

- [ ] **Step 5: Run the focused component test**

Run:

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx
```

Expected: PASS, including existing copy/open action tests and the new IPC/X assertions.

### Task 4: Remove the orphaned renderer webpage parser path

**Files:**

- Modify: `src/renderer/utils/fetch.ts`
- Modify: `src/renderer/utils/__tests__/fetch.test.ts`

- [ ] **Step 1: Remove only exports orphaned by the migration**

From `fetch.ts`, remove:

- Type-only imports for Readability, Turndown, and `WebSearchProviderResult`.
- `isAbortError`.
- `noContent` and `ResponseFormat`.
- Readability/Turndown lazy initialization state and helpers.
- `isValidUrl`.
- `fetchWebContents`.
- `fetchWebContent`.

After those removals, `fetch.ts` must contain this complete implementation:

```ts
import { loggerService } from '@logger'

const logger = loggerService.withContext('Utils:fetch')

/**
 * Check if a URL is an X/Twitter post URL
 */
export function isXPostUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    return (host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * Fetch tweet content via X oEmbed API
 * @see https://docs.x.com/x-for-websites/oembed-api
 */
export async function fetchXOEmbed(url: string): Promise<{ author: string; text: string } | null> {
  try {
    const oembedUrl = `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`
    const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) return null
    const data = await response.json()
    const parser = new DOMParser()
    const doc = parser.parseFromString(data.html || '', 'text/html')
    const paragraphs = doc.querySelectorAll('blockquote p')
    const text = Array.from(paragraphs)
      .map((p) => p.textContent)
      .join('\n')
    return {
      author: data.author_name || '',
      text: text || ''
    }
  } catch (e) {
    logger.warn('Failed to fetch X oEmbed', e as Error)
    return null
  }
}

export const xOembedKey = (url: string) => `xOembed/${url}`

export async function fetchRedirectUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    return response.url
  } catch (e) {
    logger.error('Failed to fetch redirect url', e as Error)
    return url
  }
}
```

Do not move X oEmbed into main and do not delete `fetchRedirectUrl` in this bug fix.

- [ ] **Step 2: Narrow `fetch.test.ts` to the still-retained redirect helper**

Delete parser mocks and every `fetchWebContent`/`fetchWebContents` suite. Keep the two redirect tests in a minimal file:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRedirectUrl } from '../fetch'

describe('fetchRedirectUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('returns the final redirect URL', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ url: 'https://redirected.com/final' } as unknown as Response)

    await expect(fetchRedirectUrl('https://example.com')).resolves.toBe('https://redirected.com/final')
  })

  it('returns the original URL on error', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

    await expect(fetchRedirectUrl('https://example.com')).resolves.toBe('https://example.com')
  })
})
```

- [ ] **Step 3: Prove no production references remain**

Run:

```bash
rg -n "fetchWebContent|fetchWebContents|noContent" src
```

Expected: no matches. Do not treat unrelated local variables named `noContent` as failures if future upstream changes add them; the removed exports themselves must have no matches.

- [ ] **Step 4: Run the focused renderer tests**

Run:

```bash
pnpm exec vitest run --project renderer \
  src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx \
  src/renderer/components/chat/messages/markdown/__tests__/CitationTooltip.test.tsx \
  src/renderer/utils/__tests__/fetch.test.ts
```

Expected: PASS. `CitationTooltip.test.tsx` is included as a regression guard even though its production file is unchanged.

### Task 5: Focused integration verification and handoff

**Files:**

- Verify all files listed in the File Map.
- Do not modify unrelated files produced by existing user work.

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
pnpm exec vitest run --project main \
  src/main/utils/__tests__/citationPreview.test.ts \
  src/main/ipc/handlers/__tests__/citation.test.ts

pnpm exec vitest run --project renderer \
  src/renderer/components/chat/messages/blocks/__tests__/CitationsList.test.tsx \
  src/renderer/components/chat/messages/markdown/__tests__/CitationTooltip.test.tsx \
  src/renderer/utils/__tests__/fetch.test.ts
```

Expected: all listed tests PASS. These commands must not expand to the full main or renderer projects.

- [ ] **Step 2: Run repository-required static checks without the full test suite**

Run:

```bash
pnpm lint
pnpm format
pnpm docs:check-links
```

Expected: all commands exit 0. `pnpm lint` includes type checking, i18n checks, and formatting; it does not run Vitest.

- [ ] **Step 3: Re-run focused tests after write-mode lint/format**

Run the exact two Vitest commands from Step 1 again.

Expected: all listed tests PASS after any formatter changes.

- [ ] **Step 4: Audit the final diff and boundaries**

Run:

```bash
git diff --check
git status --short
git diff -- \
  src/shared/ipc/schemas/citation.ts \
  src/shared/ipc/schemas/ipcSchemas.ts \
  src/main/ipc/handlers/citation.ts \
  src/main/ipc/handlers/ipcHandlers.ts \
  src/main/utils/citationPreview.ts \
  src/renderer/components/chat/messages/blocks/CitationsList.tsx \
  src/renderer/utils/fetch.ts
```

Confirm from the diff:

- There is exactly one new IPC route: `citation.fetch_preview`.
- Its input is `{ url }`; its output is `{ content }`; there are no provider fields.
- `web_search.fetch_urls`, `WebSearchService`, `CitationTooltip`, and X oEmbed production behavior are unchanged.
- Timeout creation occurs inside the queued task.
- Same-URL sharing covers only in-flight requests; SWR remains the completed-result cache.
- Empty preview content produces no toast, placeholder, or retry loop.
- No full `pnpm test` or `pnpm build:check` was run.

- [ ] **Step 5: Hand off without committing**

Report the focused test counts and static-check results, and explicitly state that the full suite was not run by request. Leave changes uncommitted because `pnpm build:check` is mandatory before commits and necessarily runs `pnpm test`.
