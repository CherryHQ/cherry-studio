import { toOpenAPISchema } from '@elysia/openapi'
import { ScalarRender } from '@elysia/openapi/scalar'
import { getAppLanguage, SUPPORTED_LANGUAGES, t } from '@main/i18n'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { languageNativeNameMap } from '@shared/utils/languages'
import type { AnyElysia } from 'elysia'
import * as z from 'zod'

/** Path under which OpenAPI docs (UI) and the JSON spec (`${OPENAPI_PATH}/json`) are served. */
export const OPENAPI_PATH = '/openapi' as const

/**
 * Pinned rather than `@latest`: the language switcher below is inserted into
 * Scalar's own toolbar and wears its utility classes, so an upstream release
 * can silently break it (or change its defaults — 1.63.0 turned "Ask AI" on by
 * default for localhost) in an app build we already shipped. Bump this
 * deliberately, with a look at the rendered page.
 */
const SCALAR_VERSION = '1.63.0'

/**
 * Scalar's own UI chrome (search, "Body"/"required" labels, buttons, …) ships
 * pre-translated for these locales only — see
 * https://github.com/scalar/scalar/blob/main/documentation/localization.md.
 * Languages we support but Scalar doesn't (zh-TW included, per product
 * decision — Scalar has no Traditional Chinese chrome and we chose not to
 * substitute Simplified) fall back to Scalar's own English chrome; the doc's
 * own prose (descriptions, see below) is still translated for them.
 */
const SCALAR_CHROME_LOCALE: Partial<Record<LanguageVarious, string>> = {
  'en-US': 'en',
  'zh-CN': 'zh-CN',
  'ru-RU': 'ru',
  'de-DE': 'de',
  'es-ES': 'es',
  'fr-FR': 'fr'
}

/**
 * Tag names, kept as upstream-canonical API identifiers and never translated:
 * the docs group endpoints by the API they are compatible with, the way the
 * upstream references do, so a reader can map a group straight onto the SDK
 * they already use. They also travel into the machine-readable spec, where a
 * translated name would produce localized module names in generated clients.
 * Only the tag *descriptions* (and each operation's `description`) are
 * localized.
 */
export const DOC_TAGS = {
  openai: 'OpenAI API',
  anthropic: 'Anthropic API',
  gemini: 'Gemini API',
  cherry: 'Cherry Studio'
} as const

/**
 * The i18n key each route hands to `detail.description`. Routes reference these
 * slots instead of writing key strings, and `docDescriptions` below must return
 * one entry per slot — so adding a route without translating it fails to
 * compile rather than rendering a raw key in the docs.
 */
export const DOC_DESCRIPTIONS = {
  chat_completions: 'apiGateway.docs.operations.chat_completions',
  count_tokens: 'apiGateway.docs.operations.count_tokens',
  generate_content: 'apiGateway.docs.operations.generate_content',
  get_knowledge_base: 'apiGateway.docs.operations.get_knowledge_base',
  health: 'apiGateway.docs.operations.health',
  info: 'apiGateway.docs.operations.info',
  list_knowledge_bases: 'apiGateway.docs.operations.list_knowledge_bases',
  list_models: 'apiGateway.docs.operations.list_models',
  messages: 'apiGateway.docs.operations.messages',
  responses: 'apiGateway.docs.operations.responses',
  search_knowledge_bases: 'apiGateway.docs.operations.search_knowledge_bases'
} as const

type DocDescriptionSlot = keyof typeof DOC_DESCRIPTIONS

/**
 * One literal `t` call per slot: `scripts/check-i18n.ts` statically verifies
 * that every translation call in main passes a literal key, so the keys cannot
 * be fed in from `DOC_DESCRIPTIONS` by variable. The return type ties the two
 * together instead — a slot missing here is a type error.
 */
function docDescriptions(lang: LanguageVarious): Record<DocDescriptionSlot, string> {
  return {
    chat_completions: t('apiGateway.docs.operations.chat_completions', undefined, lang),
    count_tokens: t('apiGateway.docs.operations.count_tokens', undefined, lang),
    generate_content: t('apiGateway.docs.operations.generate_content', undefined, lang),
    get_knowledge_base: t('apiGateway.docs.operations.get_knowledge_base', undefined, lang),
    health: t('apiGateway.docs.operations.health', undefined, lang),
    info: t('apiGateway.docs.operations.info', undefined, lang),
    list_knowledge_bases: t('apiGateway.docs.operations.list_knowledge_bases', undefined, lang),
    list_models: t('apiGateway.docs.operations.list_models', undefined, lang),
    messages: t('apiGateway.docs.operations.messages', undefined, lang),
    responses: t('apiGateway.docs.operations.responses', undefined, lang),
    search_knowledge_bases: t('apiGateway.docs.operations.search_knowledge_bases', undefined, lang)
  }
}

function isSupportedLanguage(value: string | null): value is LanguageVarious {
  return !!value && (SUPPORTED_LANGUAGES as string[]).includes(value)
}

/** `?lang=` on the docs routes, defaulting to (and validated against) the app's own language list. */
export function resolveDocsLanguage(url: URL): LanguageVarious {
  const requested = url.searchParams.get('lang')
  return isSupportedLanguage(requested) ? requested : getAppLanguage()
}

/** The subset of an OpenAPI operation this module rewrites. */
type DocOperation = { description?: string }

/**
 * Build the OpenAPI document for `lang` and the gateway's listening address.
 *
 * `toOpenAPISchema` walks the live route table, so this must run after every
 * route is registered (it does — it runs per request). Routes carry i18n *keys*
 * in `detail.description` (see DOC_DESCRIPTIONS); they are resolved here, once
 * per request, which is what lets one route registration serve every language.
 * The returned `paths`/`components` are freshly built on each call, so
 * rewriting them in place mutates nothing shared.
 */
export function buildOpenApiDocument(app: AnyElysia, lang: LanguageVarious, serverUrl: string) {
  const { paths, components } = toOpenAPISchema(app, undefined, undefined, { zod: z.toJSONSchema })

  const descriptions = docDescriptions(lang)
  const byKey = new Map<string, string>(
    Object.entries(DOC_DESCRIPTIONS).map(([slot, key]) => [key, descriptions[slot as DocDescriptionSlot]])
  )

  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue
      const { description } = operation as DocOperation
      const translated = description === undefined ? undefined : byKey.get(description)
      if (translated !== undefined) (operation as DocOperation).description = translated
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Cherry Studio API',
      version: '1.0.0',
      description: t('apiGateway.docs.description', undefined, lang)
    },
    tags: [
      { name: DOC_TAGS.openai, description: t('apiGateway.docs.tags.openai', undefined, lang) },
      { name: DOC_TAGS.anthropic, description: t('apiGateway.docs.tags.anthropic', undefined, lang) },
      { name: DOC_TAGS.gemini, description: t('apiGateway.docs.tags.gemini', undefined, lang) },
      { name: DOC_TAGS.cherry, description: t('apiGateway.docs.tags.cherry', undefined, lang) }
    ],
    // An absolute URL keeps Scalar's generated curl examples copyable.
    servers: [{ url: serverUrl }],
    paths,
    components
  }
}

/**
 * A language dropdown inserted INTO Scalar's own toolbar (`<header
 * class="api-reference-toolbar">`) as a true sibling of its Configure/Share/
 * Deploy buttons, wearing the exact classes copied off the live Configure
 * button. Being inside that subtree is what makes it render identically: an
 * earlier out-of-tree copy of the same classes rendered near-black/bold —
 * Scalar's utility styles don't fully resolve outside its app root — and
 * absolute-positioning beside the toolbar could never inherit its exact flex
 * alignment either.
 *
 * Scalar's Vue reactivity owns that subtree and drops foreign nodes on
 * re-render, so a MutationObserver holds a reference to the node and re-inserts
 * it whenever it leaves the document.
 *
 * The visible label is a plain <span>, not the <select> itself: a <select>'s
 * own closed-state text ignores `color`/`font: inherit` in this engine (the
 * chevron SVG beside it took the same inherited color fine), so the real
 * <select> is a transparent overlay handling interaction/accessibility while
 * the span renders what's seen.
 *
 * Every option's `value` is one of our own `LanguageVarious` codes, so no
 * user-controlled input reaches this markup — nothing here needs HTML-escaping.
 */
function languageSwitcherHtml(currentLang: LanguageVarious): string {
  const options = SUPPORTED_LANGUAGES.map(
    (lang) =>
      `<option value="${lang}"${lang === currentLang ? ' selected' : ''}>${languageNativeNameMap[lang]}</option>`
  ).join('')

  return `<div id="cs-lang-switcher" class="text-c-2 hover:text-c-1 hover:bg-b-2 flex items-center gap-1 rounded px-2 py-2.25 text-base leading-none" style="display:none">
  <span>${languageNativeNameMap[currentLang]}</span>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true" role="presentation" class="size-3"><g><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"></path></g></svg>
  <select aria-label="${t('apiGateway.docs.language_switcher_label', undefined, currentLang)}" onchange="location.href='${OPENAPI_PATH}?lang='+this.value">
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
 * Styles injected into the page body rather than passed as Scalar's `customCss`
 * option: `ScalarRender` *replaces* its own Elysia theme with `customCss`
 * instead of appending, so passing it there would drop the theme entirely.
 *
 * The layout rules below override Scalar's Vue-scoped defaults
 * (`.section[data-v-<hash>]`, specificity 0-2-0). Ours must out-specify them
 * without naming the hash — it changes on every Scalar release — and without
 * relying on order, since Scalar injects its stylesheet at runtime, after this
 * one. Hence the leading `body`: same class count, one more element, no hash.
 */
const DOCS_CSS = `<style>
  #cs-lang-switcher { position: relative; cursor: pointer; }
  #cs-lang-switcher select {
    position: absolute; inset: 0; opacity: 0; border: none; cursor: pointer; width: 100%; height: 100%;
  }
  /* Scalar pads every section by 90px top and bottom, which strands a short
     operation in a screenful of whitespace. */
  body .section-container .section { padding-top: 36px; padding-bottom: 36px; }
  /* A tag and the operations under it are both rendered at 24px/600, so a group
     reads as a sibling of its own endpoints. Demote the operation headings and
     give each group a rule above it. */
  body .section-container h3.section-header-label { font-size: 18px; }
  body .tag-section-container > .section:first-child {
    border-top: 1px solid var(--scalar-border-color);
    padding-top: 48px;
  }
</style>`

/**
 * The Scalar docs page for `lang`, pointed at the spec URL for that same
 * language. Scalar's chrome locale is a page-load-time setting, so switching
 * language reloads the page (`?lang=`) rather than swapping the document
 * client-side: Scalar's native multi-document `sources` switcher — the obvious
 * fit — silently drops every document in the published bundle, leaving the page
 * on its loading skeleton and logging "Document '' not found in configList".
 */
export function renderDocsPage(lang: LanguageVarious, specUrl: string): string {
  const html = ScalarRender(
    {
      title: 'Cherry Studio API',
      version: '1.0.0',
      description: t('apiGateway.docs.description', undefined, lang)
    },
    {
      version: SCALAR_VERSION,
      cdn: `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.min.js`,
      url: specUrl,
      localization: { locale: SCALAR_CHROME_LOCALE[lang] },
      // Scalar's "Ask AI" uploads the OpenAPI document to api.scalar.com and
      // sends chat to Scalar's own model — third-party data transfer we have not
      // asked users to accept. It is on by default on localhost, so it must be
      // turned off explicitly.
      agent: { disabled: true },
      _integration: 'elysiajs'
    }
  )

  return html.replace('<body>', `<body>${DOCS_CSS}${languageSwitcherHtml(lang)}`)
}
