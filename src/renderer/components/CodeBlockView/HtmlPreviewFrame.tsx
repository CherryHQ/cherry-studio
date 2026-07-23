/* eslint-disable @eslint-react/dom/no-missing-iframe-sandbox -- sandbox is always supplied via the (defaulted) prop; the rule can't statically resolve the dynamic value. */
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

function injectHeadElement(html: string, element: string): string {
  const headMatch = html.match(/<head(?:\s[^>]*)?>/i)
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length
    return `${html.slice(0, insertAt)}${element}${html.slice(insertAt)}`
  }

  const htmlMatch = html.match(/<html(?:\s[^>]*)?>/i)
  if (htmlMatch?.index !== undefined) {
    const insertAt = htmlMatch.index + htmlMatch[0].length
    return `${html.slice(0, insertAt)}<head>${element}</head>${html.slice(insertAt)}`
  }

  const doctypeMatch = html.match(/<!doctype\s+html[^>]*>/i)
  if (doctypeMatch?.index !== undefined) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length
    return `${html.slice(0, insertAt)}<head>${element}</head>${html.slice(insertAt)}`
  }

  return `<head>${element}</head>${html}`
}

export function injectHtmlPreviewBase(html: string, baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL): string {
  if (!html.trim() || /<base(?:\s|>|\/)/i.test(html)) return html
  return injectHeadElement(html, `<base href="${escapeHtmlAttribute(baseUrl)}">`)
}

export function injectHtmlPreviewCsp(html: string, csp: string): string {
  if (!html.trim()) return html
  return injectHeadElement(html, `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">`)
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
    const srcDoc = csp ? injectHtmlPreviewCsp(withBase, csp) : withBase
    return (
      <div className="h-full w-full overflow-hidden bg-background">
        {html.trim() ? (
          <iframe
            ref={iframeRef}
            srcDoc={srcDoc}
            title={title}
            sandbox={sandbox}
            className="h-full w-full border-0 bg-background"
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
