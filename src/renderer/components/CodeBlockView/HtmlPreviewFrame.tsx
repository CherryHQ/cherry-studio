/* eslint-disable @eslint-react/dom/no-missing-iframe-sandbox -- sandbox is always supplied via the (defaulted) prop; the rule can't statically resolve the dynamic value. */
import { memo, type Ref } from 'react'

export const HTML_PREVIEW_DEFAULT_BASE_URL = 'about:srcdoc'
// `allow-same-origin` is required so the parent can read the iframe's `contentDocument`
// for HTML-artifact screenshot capture (save / copy PNG). Without it the sandbox is an
// opaque origin, `contentDocument` is null, and capture silently no-ops.

export const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms'

// Restricted sandbox for previewing untrusted local files. It intentionally drops
// `allow-same-origin`, so a malicious file's scripts run in an opaque origin and
// cannot reach the parent window's preload APIs (`parent.api`) to read/exfiltrate
// arbitrary local files. Use this — never the artifact sandbox above — for any
// on-disk file whose contents we don't control.
export const HTML_PREVIEW_RESTRICTED_SANDBOX = 'allow-scripts allow-forms'

interface HtmlPreviewFrameProps {
  html: string
  title: string
  baseUrl?: string
  emptyText?: string
  /** iframe `sandbox` value. Defaults to the artifact sandbox (same-origin, for
   *  screenshot capture); pass {@link HTML_PREVIEW_RESTRICTED_SANDBOX} for untrusted files. */
  sandbox?: string
  iframeRef?: Ref<HTMLIFrameElement>
}

const escapeHtmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function injectHtmlPreviewBase(html: string, baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL): string {
  if (!html.trim() || /<base(?:\s|>|\/)/i.test(html)) return html

  const base = `<base href="${escapeHtmlAttribute(baseUrl)}">`
  const headMatch = html.match(/<head(?:\s[^>]*)?>/i)
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length
    return `${html.slice(0, insertAt)}${base}${html.slice(insertAt)}`
  }

  const htmlMatch = html.match(/<html(?:\s[^>]*)?>/i)
  if (htmlMatch?.index !== undefined) {
    const insertAt = htmlMatch.index + htmlMatch[0].length
    return `${html.slice(0, insertAt)}<head>${base}</head>${html.slice(insertAt)}`
  }

  const doctypeMatch = html.match(/<!doctype\s+html[^>]*>/i)
  if (doctypeMatch?.index !== undefined) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length
    return `${html.slice(0, insertAt)}<head>${base}</head>${html.slice(insertAt)}`
  }

  return `<head>${base}</head>${html}`
}

export const HtmlPreviewFrame = memo<HtmlPreviewFrameProps>(
  ({
    html,
    title,
    baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL,
    emptyText,
    sandbox = HTML_PREVIEW_IFRAME_SANDBOX,
    iframeRef
  }) => {
    return (
      <div className="h-full w-full overflow-hidden bg-background">
        {html.trim() ? (
          <iframe
            ref={iframeRef}
            srcDoc={injectHtmlPreviewBase(html, baseUrl)}
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
