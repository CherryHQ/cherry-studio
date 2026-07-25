import { bearer } from '@elysia/bearer'
import { cors } from '@elysia/cors'
import { node } from '@elysia/node'
import { openapi } from '@elysia/openapi'
import { ScalarRender } from '@elysia/openapi/scalar'
import { loggerService } from '@logger'
import { getAppLanguage, SUPPORTED_LANGUAGES, t } from '@main/i18n'
import { DataApiError } from '@shared/data/api/errors'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { languageNativeNameMap } from '@shared/utils/languages'
import { Elysia } from 'elysia'
import { v4 as uuidv4 } from 'uuid'
import * as z from 'zod'

import { gatewayErrorHandler } from './errors'
import { authorizeApiRequest } from './middleware/auth'
import { chatRoutes } from './routes/chat'
import { geminiRoutes } from './routes/gemini'
import { knowledgeRoutes } from './routes/knowledge'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { responsesRoutes } from './routes/responses'

const logger = loggerService.withContext('ApiGateway')

/** Path under which OpenAPI docs (UI) and JSON spec (`${OPENAPI_PATH}/json`) are served. */
export const OPENAPI_PATH = '/openapi' as const

/** Introspection-only mount: never linked publicly, just lets `openapi()` walk the real routes. */
const OPENAPI_SOURCE_PATH = `${OPENAPI_PATH}/_source` as const

/**
 * Scalar's own UI chrome (search, "Body"/"required" labels, buttons, …) ships
 * pre-translated for these locales only — see
 * https://github.com/scalar/scalar/blob/main/documentation/localization.md.
 * Languages we support but Scalar doesn't (zh-TW included, per product
 * decision — Scalar has no Traditional Chinese chrome and we chose not to
 * substitute Simplified) fall back to Scalar's own English chrome; the doc
 * *content* (title/tags/summaries below) is still fully translated for them.
 */
const SCALAR_CHROME_LOCALE: Partial<Record<LanguageVarious, string>> = {
  'en-US': 'en',
  'zh-CN': 'zh-CN',
  'ru-RU': 'ru',
  'de-DE': 'de',
  'es-ES': 'es',
  'fr-FR': 'fr'
}

function isSupportedLanguage(value: string | null): value is LanguageVarious {
  return !!value && (SUPPORTED_LANGUAGES as string[]).includes(value)
}

/** `?lang=` on the docs routes, defaulting to (and validated against) the app's own language list. */
function resolveDocsLanguage(url: URL): LanguageVarious {
  const requested = url.searchParams.get('lang')
  return isSupportedLanguage(requested) ? requested : getAppLanguage()
}

/**
 * A language dropdown inserted INTO Scalar's own toolbar (`<header
 * class="api-reference-toolbar">`, a stable, semantically-named class) as a
 * true sibling of its Developer Tools/Configure/Share/Deploy buttons, wearing
 * the exact classes copied off the live Configure button. Being inside that
 * subtree is what makes it render pixel-identically: an earlier out-of-tree
 * copy of the same classes rendered near-black/bold on the user's machine —
 * Scalar's utility styles don't fully resolve outside its app root — and
 * absolute-positioning beside the toolbar could never inherit its exact
 * flex alignment either.
 *
 * Scalar's Vue reactivity owns that subtree and drops foreign nodes on
 * re-render, so a MutationObserver holds a reference to the node and
 * re-inserts it whenever it leaves the document.
 *
 * The visible label is a plain <span>, not the <select> itself: a <select>'s
 * own closed-state text ignores `color`/`font: inherit` in this engine (the
 * chevron SVG beside it took the same inherited color fine), so the real
 * <select> is a transparent overlay handling interaction/accessibility while
 * the span renders what's seen.
 *
 * Every option's `value` is one of our own `LanguageVarious` codes, so no
 * user-controlled input reaches this markup — nothing here needs
 * HTML-escaping.
 */
function languageSwitcherHtml(currentLang: LanguageVarious): string {
  const options = SUPPORTED_LANGUAGES.map(
    (lang) =>
      `<option value="${lang}"${lang === currentLang ? ' selected' : ''}>${languageNativeNameMap[lang]}</option>`
  ).join('')

  return `<style>
  #cs-lang-switcher { position: relative; cursor: pointer; }
  #cs-lang-switcher select {
    position: absolute; inset: 0; opacity: 0; border: none; cursor: pointer; width: 100%; height: 100%;
  }
</style>
<div id="cs-lang-switcher" class="text-c-2 hover:text-c-1 hover:bg-b-2 flex items-center gap-1 rounded px-2 py-2.25 text-base leading-none" style="display:none">
  <span>${languageNativeNameMap[currentLang]}</span>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true" role="presentation" class="size-3"><g><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"></path></g></svg>
  <select onchange="location.href='${OPENAPI_PATH}?lang='+this.value">
    ${options}
  </select>
</div>
<script>
  (function () {
    var mine = document.getElementById('cs-lang-switcher')
    function insert() {
      if (!mine) return false
      if (mine.isConnected && mine.closest('header.api-reference-toolbar')) return true
      var header = document.querySelector('header.api-reference-toolbar')
      var buttons = header ? header.querySelectorAll('button, a') : []
      var last = buttons[buttons.length - 1]
      if (!last) return false
      // After the LAST button (Deploy), not before the first: the Developer
      // Tools button carries the margin-left:auto that right-aligns the whole
      // group, so anything inserted before it gets left behind at the
      // toolbar's far-left flex start instead of joining the group.
      last.insertAdjacentElement('afterend', mine)
      mine.style.display = ''
      return true
    }
    var tries = 0
    var timer = setInterval(function () {
      tries += 1
      if (insert() || tries > 100) clearInterval(timer)
    }, 100)
    new MutationObserver(function () {
      insert()
    }).observe(document.body, { childList: true, subtree: true })
  })()
</script>`
}

/**
 * Every i18n key `translateOpenApiDoc` can encounter — one literal call to
 * `t` per key. `scripts/check-i18n.ts` statically verifies every call to `t`
 * in main uses a literal key (so it can catch drift against the catalog); the
 * doc keys below are otherwise looked up dynamically (baked into route
 * `detail.tags`/`summary`, see routes/chat.ts), so this table is what keeps
 * every call site literal while still letting `translateOpenApiDoc` resolve
 * any of them by key.
 */
function buildDocTranslations(lang: LanguageVarious): Record<string, string> {
  return {
    'apiGateway.docs.description': t('apiGateway.docs.description', undefined, lang),
    'apiGateway.docs.tags.general': t('apiGateway.docs.tags.general', undefined, lang),
    'apiGateway.docs.tags.health': t('apiGateway.docs.tags.health', undefined, lang),
    'apiGateway.docs.tags.chat': t('apiGateway.docs.tags.chat', undefined, lang),
    'apiGateway.docs.tags.responses': t('apiGateway.docs.tags.responses', undefined, lang),
    'apiGateway.docs.tags.messages': t('apiGateway.docs.tags.messages', undefined, lang),
    'apiGateway.docs.tags.models': t('apiGateway.docs.tags.models', undefined, lang),
    'apiGateway.docs.tags.knowledge': t('apiGateway.docs.tags.knowledge', undefined, lang),
    'apiGateway.docs.tags.gemini': t('apiGateway.docs.tags.gemini', undefined, lang),
    'apiGateway.docs.summaries.generate_content': t('apiGateway.docs.summaries.generate_content', undefined, lang),
    'apiGateway.docs.summaries.chat_completion': t('apiGateway.docs.summaries.chat_completion', undefined, lang),
    'apiGateway.docs.summaries.count_tokens': t('apiGateway.docs.summaries.count_tokens', undefined, lang),
    'apiGateway.docs.summaries.create_message': t('apiGateway.docs.summaries.create_message', undefined, lang),
    'apiGateway.docs.summaries.create_response': t('apiGateway.docs.summaries.create_response', undefined, lang),
    'apiGateway.docs.summaries.get_knowledge_base': t('apiGateway.docs.summaries.get_knowledge_base', undefined, lang),
    'apiGateway.docs.summaries.health': t('apiGateway.docs.summaries.health', undefined, lang),
    'apiGateway.docs.summaries.info': t('apiGateway.docs.summaries.info', undefined, lang),
    'apiGateway.docs.summaries.list_knowledge_bases': t(
      'apiGateway.docs.summaries.list_knowledge_bases',
      undefined,
      lang
    ),
    'apiGateway.docs.summaries.list_models': t('apiGateway.docs.summaries.list_models', undefined, lang),
    'apiGateway.docs.summaries.search_knowledge_bases': t(
      'apiGateway.docs.summaries.search_knowledge_bases',
      undefined,
      lang
    )
  }
}

/**
 * The routes below bake i18n *keys* (not translated text) into `detail.tags`/
 * `summary` and into this doc's `info.description`/`tags[].name` — see
 * routes/chat.ts. Translate every one of those known fields into `lang`,
 * without mutating `doc` (the plugin memoizes and reuses this same object).
 */
function translateOpenApiDoc(doc: any, lang: LanguageVarious): any {
  const translations = buildDocTranslations(lang)
  const translate = (key: string) => translations[key] ?? key

  const translated = structuredClone(doc)
  if (typeof translated.info?.description === 'string') {
    translated.info.description = translate(translated.info.description)
  }
  if (Array.isArray(translated.tags)) {
    translated.tags = translated.tags.map((tag: { name: string }) => ({ ...tag, name: translate(tag.name) }))
  }
  for (const pathItem of Object.values<any>(translated.paths ?? {})) {
    for (const operation of Object.values<any>(pathItem ?? {})) {
      if (!operation || typeof operation !== 'object') continue
      if (Array.isArray(operation.tags)) {
        operation.tags = operation.tags.map(translate)
      }
      if (typeof operation.summary === 'string') {
        operation.summary = translate(operation.summary)
      }
    }
  }
  return translated
}

/**
 * Protected `/v1` API routes. The auth guard is `scoped` so it propagates to
 * every plugin mounted here, but NOT to the public app-level routes. Errors are
 * shaped by the single root `gatewayErrorHandler` (see `buildApp`), which selects
 * the dialect by path.
 */
const v1Routes = new Elysia({ prefix: '/v1' })
  // `@elysia/bearer` derives `bearer` from `Authorization: Bearer …` / `?access_token`.
  .use(bearer())
  .guard({
    as: 'scoped',
    beforeHandle: ({ bearer, headers, set }) => {
      const failure = authorizeApiRequest(headers['x-api-key'], bearer)
      if (!failure) return undefined
      set.status = failure.status
      return { error: failure.error }
    }
  })
  .use(messagesRoutes)
  .use(chatRoutes)
  .use(responsesRoutes)
  .use(modelsRoutes)
  .use(knowledgeRoutes)

/** Where the gateway listens; used to render an absolute OpenAPI server URL. */
interface BuildAppOptions {
  host?: string
  port?: number
}

/**
 * Build the Elysia application (Node adapter). Assembles CORS, OpenAPI docs,
 * request logging + `X-Request-ID`, error handling, public info routes, and the
 * protected API route plugins.
 *
 * `host`/`port` default to the `feature.api_gateway.*` preference defaults so the
 * integration tests can call `buildApp()` with no arguments; `server.ts` passes
 * the live preference values. They populate the OpenAPI `servers` URL so Scalar
 * renders copyable absolute curl examples (e.g. `curl http://127.0.0.1:23333/health`)
 * instead of relative paths.
 *
 * Exported for both the runtime server (`server.ts`) and the integration tests.
 */
export function buildApp({ host = '127.0.0.1', port = 23333 }: BuildAppOptions = {}) {
  const app = new Elysia({ adapter: node() })
    .use(
      cors({
        origin: true,
        // Reflect the client's requested headers (the @elysia/cors default for
        // `allowedHeaders: true`) rather than a fixed allowlist. Browser SDK clients
        // send dialect-specific headers — Anthropic's `x-api-key` / `anthropic-version`
        // / `anthropic-beta`, OpenAI's `Authorization` / `openai-organization`, etc. —
        // and a static list silently fails their preflight. CORS is not the auth
        // boundary here (the API key is; non-browser clients ignore CORS entirely), so
        // reflecting the requested headers is the correct, maintenance-free choice.
        allowedHeaders: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
      })
    )
    // Introspection-only: walks the real routes to build the OpenAPI schema, but
    // mounts no public HTML/JSON of its own (`provider: null`) — the doc content
    // it produces is keyed (see translateOpenApiDoc), not human text, so it must
    // never be served directly. The two public routes below translate + serve it.
    .use(
      openapi({
        path: OPENAPI_SOURCE_PATH,
        provider: null,
        mapJsonSchema: { zod: z.toJSONSchema },
        documentation: {
          info: {
            title: 'Cherry Studio API',
            version: '1.0.0',
            description: 'apiGateway.docs.description'
          },
          tags: [
            { name: 'apiGateway.docs.tags.general' },
            { name: 'apiGateway.docs.tags.health' },
            { name: 'apiGateway.docs.tags.chat' },
            { name: 'apiGateway.docs.tags.responses' },
            { name: 'apiGateway.docs.tags.messages' },
            { name: 'apiGateway.docs.tags.models' },
            { name: 'apiGateway.docs.tags.knowledge' },
            { name: 'apiGateway.docs.tags.gemini' }
          ],
          // Absolute base URL so Scalar renders copyable curl examples with the
          // full address instead of relative paths (e.g. `curl /health`).
          servers: [{ url: `http://${host}:${port}` }]
        }
      })
    )
    // Stamp a request id and record the start time for latency logging.
    .onRequest(({ set }) => {
      set.headers['x-request-id'] = uuidv4()
    })
    .derive(() => ({ requestStartedAt: Date.now() }))
    .onAfterResponse(({ request, path, set, requestStartedAt }) => {
      const durationMs = typeof requestStartedAt === 'number' ? Date.now() - requestStartedAt : undefined
      logger.info('API request completed', {
        method: request.method,
        path,
        statusCode: set.status,
        durationMs
      })
    })
    // Single root error handler — shapes every error into the dialect matching
    // the request path (see ./errors). `.error()` registers the v2 error type so
    // the handler's `code` is typed to include `'DATA_API'`.
    .error({ DATA_API: DataApiError })
    .onError(gatewayErrorHandler)
    // Translated OpenAPI JSON spec — `?lang=` picks the language (defaults to
    // the app's current language); Scalar's own per-language `sources` (below)
    // each point back here with their language baked into the URL.
    .get(`${OPENAPI_PATH}/json`, async ({ request }) => {
      const lang = resolveDocsLanguage(new URL(request.url))
      const sourceDoc = await app
        .handle(new Request(`http://internal${OPENAPI_SOURCE_PATH}/json`))
        .then((r) => r.json())
      return translateOpenApiDoc(sourceDoc, lang)
    })
    // OpenAPI docs UI (Scalar). `sources` is Scalar's native multi-document
    // switcher — repurposed here as the docs' language dropdown: each entry is
    // the same API, translated, fetched client-side on selection (no reload).
    // Scalar's own chrome locale (Search, Body, required, …) is a single,
    // page-load-time setting — see SCALAR_CHROME_LOCALE — and does not follow
    // the dropdown; only the doc content does.
    .get(OPENAPI_PATH, ({ request }) => {
      const url = new URL(request.url)
      const lang = resolveDocsLanguage(url)

      const html = ScalarRender(
        {
          title: 'Cherry Studio API',
          version: '1.0.0',
          description: t('apiGateway.docs.description', undefined, lang)
        },
        {
          version: 'latest',
          cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.min.js',
          url: `${url.origin}${OPENAPI_PATH}/json?lang=${lang}`,
          localization: { locale: SCALAR_CHROME_LOCALE[lang] },
          _integration: 'elysiajs'
        }
      )
      // Scalar's own native multi-document `sources` switcher — the natural fit for a
      // language dropdown — silently drops every document in the published bundle
      // (@scalar/api-reference@1.62.5): the page never leaves its loading skeleton,
      // logging "Document '' not found in configList" (traced via Scalar's own
      // normalize-configurations.ts/ApiReference.vue on GitHub). So this dropdown is
      // ours: a plain `<select>` that reloads the page with `?lang=`, switching both
      // the doc content and Scalar's own chrome together.
      return new Response(html.replace('<body>', `<body>${languageSwitcherHtml(lang)}`), {
        headers: { 'content-type': 'text/html; charset=utf8' }
      })
    })
    // Public health check (no authentication).
    .get(
      '/health',
      () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      }),
      { detail: { tags: ['apiGateway.docs.tags.health'], summary: 'apiGateway.docs.summaries.health' } }
    )
    // Public API information.
    .get(
      '/',
      () => ({
        name: 'Cherry Studio API',
        version: '1.0.0',
        endpoints: {
          health: 'GET /health',
          docs: `GET ${OPENAPI_PATH}`,
          docs_json: `GET ${OPENAPI_PATH}/json`,
          chat_completions: 'POST /v1/chat/completions',
          messages: 'POST /v1/messages',
          generate_content: 'POST /v1beta/models/{model}:generateContent',
          knowledge_bases: 'GET /v1/knowledge-bases',
          knowledge_search: 'POST /v1/knowledge-bases/search'
        }
      }),
      { detail: { tags: ['apiGateway.docs.tags.general'], summary: 'apiGateway.docs.summaries.info' } }
    )
    // Gemini routes carry their own self-contained (`local`) auth guard and are
    // mounted BEFORE `v1Routes` on purpose: `v1Routes`' `scoped` guard exports to
    // the app scope and would otherwise intercept `/v1beta` requests (its guard
    // reads only `x-api-key`/Bearer, so it would 401 the Gemini `x-goog-api-key` /
    // `?key=` credentials). Registering `/v1beta` first keeps it out of that guard's
    // reach; the `local` gemini guard does not leak back onto `/v1`.
    .use(geminiRoutes)
    .use(v1Routes)

  return app
}

export type ApiGatewayApp = ReturnType<typeof buildApp>
