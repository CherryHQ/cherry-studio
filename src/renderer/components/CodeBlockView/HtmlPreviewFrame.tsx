/* eslint-disable @eslint-react/dom/no-missing-iframe-sandbox -- sandbox is always supplied via the (defaulted) prop; the rule can't statically resolve the dynamic value. */
import { Parser } from 'htmlparser2'
import { memo, type Ref } from 'react'

export const HTML_PREVIEW_DEFAULT_BASE_URL = 'about:srcdoc'

// Interactive artifact sandbox — scripts run same-origin with the app. Only for surfaces
// where running scripts is explicitly consented; pass it explicitly, never rely on defaults.
// `allow-same-origin` keeps screenshot capture able to read the iframe's `contentDocument`.
export const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms'

// Fully-restricted sandbox, and the component default. An empty `sandbox`
// applies every restriction — no scripts, no forms, opaque origin — while still rendering
// static HTML/CSS. Running NO scripts is the deliberate choice: the main window sets
// `webSecurity: false` (windowRegistry.ts), which disables the same-origin policy, so
// merely dropping `allow-same-origin` is NOT a reliable boundary — a script in an
// opaque-origin iframe could still reach `parent.api` and the legacy `fs.read*` bridge to
// read/exfiltrate arbitrary local files. Removing `allow-scripts` closes that hole
// regardless of `webSecurity`. Pair with {@link HTML_PREVIEW_RESTRICTED_CSP}. Use this —
// never the interactive artifact sandbox above — for any content whose scripts the user
// has not consented to.
export const HTML_PREVIEW_RESTRICTED_SANDBOX = ''

// Strict CSP for untrusted local-file previews, injected as a `<meta http-equiv>` tag.
// `default-src 'none'` blocks scripts and every network connection; only passive local
// resources (data/blob/file) are allowed, so a preview cannot phone home or exfiltrate
// content even though the frame is already script-less. Defense-in-depth behind the sandbox.
export const HTML_PREVIEW_RESTRICTED_CSP =
  "default-src 'none'; img-src data: blob: file:; media-src data: blob: file:; style-src 'unsafe-inline' file:; font-src data: file:"

interface HtmlPreviewFrameProps {
  html: string
  title: string
  baseUrl?: string
  emptyText?: string
  /** iframe `sandbox` value. Defaults to {@link HTML_PREVIEW_RESTRICTED_SANDBOX} — fail
   *  closed: unconsented scripts never run. Pass {@link HTML_PREVIEW_IFRAME_SANDBOX} only
   *  for surfaces where running scripts is explicitly consented. */
  sandbox?: string
  /** Content-Security-Policy injected as a `<meta http-equiv>` tag. Defaults to
   *  {@link HTML_PREVIEW_RESTRICTED_CSP} when the (effective) sandbox is the restricted
   *  one; not injected for other sandboxes (e.g. interactive artifacts need full network
   *  access). Pass an explicit value (or `''` to disable) to override. */
  csp?: string
  /** Reserve native scrollbar width for surfaces whose height tracks their content. */
  stableScrollbarGutter?: boolean
  iframeRef?: Ref<HTMLIFrameElement>
}

const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const LEADING_DOCUMENT_PREAMBLE_REGEX =
  /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>|<\?[\s\S]*?\?>))*\s*(?:<html(?:\s[^>]*)?>\s*(?:<!--[\s\S]*?-->\s*)*)?/i

function hasHtmlElement(html: string, elementName: string): boolean {
  let found = false
  const parser = new Parser(
    {
      onopentag(name) {
        if (name === elementName) found = true
      }
    },
    { lowerCaseTags: true }
  )
  parser.end(html)
  return found
}

export function injectHtmlPreviewHeadElement(html: string, element: string): string {
  const preambleEnd = html.match(LEADING_DOCUMENT_PREAMBLE_REGEX)?.[0].length ?? 0
  const remainder = html.slice(preambleEnd)
  const headMatch = remainder.match(/^<head(?:\s[^>]*)?>/i)
  if (headMatch?.index !== undefined) {
    const insertAt = preambleEnd + headMatch[0].length
    return `${html.slice(0, insertAt)}${element}${html.slice(insertAt)}`
  }

  return `${html.slice(0, preambleEnd)}<head>${element}</head>${html.slice(preambleEnd)}`
}

export function injectHtmlPreviewBase(html: string, baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL): string {
  if (!html.trim() || hasHtmlElement(html, 'base')) return html
  return injectHtmlPreviewHeadElement(html, `<base href="${escapeHtmlAttribute(baseUrl)}">`)
}

export function injectHtmlPreviewCsp(html: string, csp: string): string {
  if (!html.trim()) return html
  return injectHtmlPreviewHeadElement(
    html,
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`
  )
}

export const HTML_PREVIEW_SCROLLBAR_GUTTER_MARKER = 'data-cherry-html-preview-scrollbar'
const HTML_PREVIEW_SCROLLBAR_GUTTER_CSS = 'html{overflow-y:auto;scrollbar-gutter:stable}'
export const HTML_PREVIEW_SCROLLBAR_GUTTER_STYLE = `<style ${HTML_PREVIEW_SCROLLBAR_GUTTER_MARKER}>${HTML_PREVIEW_SCROLLBAR_GUTTER_CSS}</style>`

function hasHtmlPreviewScrollbarGutter(html: string): boolean {
  let found = false
  let ownedStyle = false
  let styleContent = ''
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'style' && HTML_PREVIEW_SCROLLBAR_GUTTER_MARKER in attributes) {
          ownedStyle = true
          styleContent = ''
        }
      },
      ontext(text) {
        if (ownedStyle) styleContent += text
      },
      onclosetag(name) {
        if (name !== 'style' || !ownedStyle) return
        found ||= styleContent === HTML_PREVIEW_SCROLLBAR_GUTTER_CSS
        ownedStyle = false
      }
    },
    { lowerCaseTags: true }
  )
  parser.end(html)
  return found
}

export function injectHtmlPreviewScrollbarGutter(html: string): string {
  if (!html.trim() || hasHtmlPreviewScrollbarGutter(html)) return html
  return injectHtmlPreviewHeadElement(html, HTML_PREVIEW_SCROLLBAR_GUTTER_STYLE)
}

export function applyHtmlPreviewScrollbarGutter(frameDocument: Document | null): void {
  const scrollRoot = frameDocument?.scrollingElement ?? frameDocument?.documentElement
  if (!scrollRoot || !('style' in scrollRoot)) return

  const style = (scrollRoot as HTMLElement).style
  style.overflowY = 'auto'
  style.scrollbarGutter = 'stable'
}

export const HtmlPreviewFrame = memo<HtmlPreviewFrameProps>(
  ({
    html,
    title,
    baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL,
    emptyText,
    sandbox = HTML_PREVIEW_RESTRICTED_SANDBOX,
    csp,
    stableScrollbarGutter = false,
    iframeRef
  }) => {
    // CSP follows the sandbox tier: restricted frames get the strict CSP, interactive
    // sandboxes keep full network access unless the caller overrides.
    const effectiveCsp = csp ?? (sandbox === HTML_PREVIEW_RESTRICTED_SANDBOX ? HTML_PREVIEW_RESTRICTED_CSP : undefined)
    const withBase = injectHtmlPreviewBase(html, baseUrl)
    const withScrollbar = stableScrollbarGutter ? injectHtmlPreviewScrollbarGutter(withBase) : withBase
    const srcDoc = effectiveCsp ? injectHtmlPreviewCsp(withScrollbar, effectiveCsp) : withScrollbar
    return (
      <div className="h-full w-full overflow-hidden bg-white">
        {html.trim() ? (
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title={title}
            sandbox={sandbox}
            className="h-full w-full border-0 bg-white"
            onLoad={
              stableScrollbarGutter
                ? (event) => applyHtmlPreviewScrollbarGutter(event.currentTarget.contentDocument)
                : undefined
            }
          />
        ) : emptyText ? (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground text-sm">
            <p>{emptyText}</p>
          </div>
        ) : null}
      </div>
    )
  }
)

export default HtmlPreviewFrame
