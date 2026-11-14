import DOMPurify from 'dompurify'
import { useEffect, useRef } from 'react'

export function summaryDocument(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'a',
      'img',
      'video',
      'audio'
    ],
    FORBID_ATTR: ['src', 'srcset', 'href', 'action', 'formaction', 'autofocus', 'tabindex']
  })
  for (const style of fragment.querySelectorAll('style')) {
    style.textContent = style.textContent?.replace(/:root\b/g, ':host') ?? ''
  }
  return fragment
}

export function MeetingSummaryView({ html, title }: { html: string; title: string }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    const base = document.createElement('style')
    base.textContent =
      ':host{display:block;contain:content;color-scheme:light}body{margin:0!important;min-height:0!important}*{box-sizing:border-box}'
    root.replaceChildren(summaryDocument(html), base)
    return () => root.replaceChildren()
  }, [html])
  return <div ref={container} role="region" aria-label={title} className="meeting-visual-summary" />
}
