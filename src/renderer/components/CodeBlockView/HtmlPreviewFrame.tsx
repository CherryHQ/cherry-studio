/* eslint-disable @eslint-react/dom/no-missing-iframe-sandbox -- sandbox is always supplied via the (defaulted) prop; the rule can't statically resolve the dynamic value. */
import { Parser } from 'htmlparser2'
import { memo, type Ref } from 'react'

export const HTML_PREVIEW_DEFAULT_BASE_URL = 'about:srcdoc'
// `allow-same-origin` is required so the parent can read the iframe's `contentDocument`
// for HTML-artifact screenshot capture (save / copy PNG). Without it the sandbox is an
// opaque origin, `contentDocument` is null, and capture silently no-ops.

export const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms'

// Fully-restricted sandbox for previewing untrusted on-disk files. An empty `sandbox`
// applies every restriction — no scripts, no forms, opaque origin — while still rendering
// static HTML/CSS. Running NO scripts is the deliberate choice: the main window sets
// `webSecurity: false` (windowRegistry.ts), which disables the same-origin policy, so
// merely dropping `allow-same-origin` is NOT a reliable boundary — a script in an
// opaque-origin iframe could still reach `parent.api` and the legacy `fs.read*` bridge to
// read/exfiltrate arbitrary local files. Removing `allow-scripts` closes that hole
// regardless of `webSecurity`. Pair with {@link HTML_PREVIEW_RESTRICTED_CSP}. Use this —
// never the artifact sandbox above — for any file whose contents we don't control.
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
  /** iframe `sandbox` value. Defaults to the artifact sandbox (same-origin, for
   *  screenshot capture); pass {@link HTML_PREVIEW_RESTRICTED_SANDBOX} for untrusted files. */
  sandbox?: string
  /** Content-Security-Policy injected as a `<meta http-equiv>` tag. Pass
   *  {@link HTML_PREVIEW_RESTRICTED_CSP} for untrusted files; omit for trusted artifacts. */
  csp?: string
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

// Default font stacks mirroring `font.css` (`--font-family` / `--code-font-family`).
// They are used when the parent document's resolved stacks are unavailable (e.g. jsdom),
// and as the fallback tail once the user's chosen font is prepended.
export const HTML_PREVIEW_DEFAULT_BODY_FONT =
  "Ubuntu, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Roboto, Oxygen, Cantarell, 'Open Sans', 'Helvetica Neue', Arial, 'Noto Sans', sans-serif"
export const HTML_PREVIEW_DEFAULT_CODE_FONT = "'Cascadia Code', 'Fira Code', Consolas, Menlo, Courier, monospace"

// The injected `<style>` lives inside an RCDATA element, so `<` / `>` must be stripped
// (escaping as `&lt;` would surface literally in CSS). Font names never contain them.
const sanitizeFontFamily = (value: string): string => value.replace(/[<>]/g, '')

export function getPreviewFontStacks(): { body: string; code: string } {
  if (typeof document === 'undefined') {
    return { body: HTML_PREVIEW_DEFAULT_BODY_FONT, code: HTML_PREVIEW_DEFAULT_CODE_FONT }
  }
  const target = document.body ?? document.documentElement
  const read = (property: string): string => {
    try {
      return getComputedStyle(target).getPropertyValue(property).trim()
    } catch {
      return ''
    }
  }
  // CSS custom properties do not cross the iframe/webview document boundary, so resolve the
  // parent's font stacks to concrete values. `--font-family` / `--code-font-family` are
  // defined on `:root` (and re-declared on `body[os='windows']`), so reading them from the
  // body yields the fully-resolved stacks including the user's font preference.
  const body = read('--font-family')
  const code = read('--code-font-family')
  return {
    body: body || HTML_PREVIEW_DEFAULT_BODY_FONT,
    code: code || HTML_PREVIEW_DEFAULT_CODE_FONT
  }
}

// Injects low-specificity element-selector defaults so unstyled preview documents inherit the
// app's fonts instead of Chromium's UA serif default. Because these rules are injected before
// any page styles and have (0,0,1) specificity, a generated page's own font rules and inline
// styles always win — this only fills the gap when the document declares no font.
export function injectHtmlPreviewDefaultFonts(html: string, stacks?: { body?: string; code?: string }): string {
  if (!html.trim()) return html
  const { body: bodyFont, code: codeFont } = { ...getPreviewFontStacks(), ...stacks }
  const styleContent = [
    `html, body { font-family: ${sanitizeFontFamily(bodyFont)}; }`,
    `pre, code, kbd, samp { font-family: ${sanitizeFontFamily(codeFont)}; }`
  ].join('\n  ')
  return injectHtmlPreviewHeadElement(html, `<style>\n  ${styleContent}\n</style>`)
}

export const HtmlPreviewFrame = memo<HtmlPreviewFrameProps>(
  ({
    html,
    title,
    baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL,
    emptyText,
    sandbox = HTML_PREVIEW_IFRAME_SANDBOX,
    csp,
    iframeRef
  }) => {
    const withBase = injectHtmlPreviewBase(html, baseUrl)
    const withDefaultFonts = injectHtmlPreviewDefaultFonts(withBase)
    const srcDoc = csp ? injectHtmlPreviewCsp(withDefaultFonts, csp) : withDefaultFonts
    return (
      <div className="h-full w-full overflow-hidden bg-white">
        {html.trim() ? (
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title={title}
            sandbox={sandbox}
            className="h-full w-full border-0 bg-white"
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
