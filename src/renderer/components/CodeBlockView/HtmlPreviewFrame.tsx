import { memo, type Ref } from 'react'

export const HTML_PREVIEW_DEFAULT_BASE_URL = 'about:srcdoc'
export const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms'

interface HtmlPreviewFrameProps {
  html: string
  title: string
  baseUrl?: string
  emptyText?: string
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

// Html artifact previews need scripts/forms for interaction, and same-origin
// keeps local preview behavior aligned across popup and ArtifactPane surfaces.
/* eslint-disable @eslint-react/dom/no-unsafe-iframe-sandbox */
export const HtmlPreviewFrame = memo<HtmlPreviewFrameProps>(
  ({ html, title, baseUrl = HTML_PREVIEW_DEFAULT_BASE_URL, emptyText, iframeRef }) => {
    return (
      <div className="h-full w-full overflow-hidden bg-background">
        {html.trim() ? (
          <iframe
            ref={iframeRef}
            srcDoc={injectHtmlPreviewBase(html, baseUrl)}
            title={title}
            sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
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
/* eslint-enable @eslint-react/dom/no-unsafe-iframe-sandbox */

export default HtmlPreviewFrame
