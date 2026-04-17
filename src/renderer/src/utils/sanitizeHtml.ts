import DOMPurify from 'dompurify'

const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select']
const COMMON_ALLOWED_ATTRS = [
  'class',
  'style',
  'href',
  'src',
  'alt',
  'title',
  'target',
  'rel',
  'tabindex',
  'data-language',
  'data-theme',
  'data-line',
  'data-highlighted-line',
  'aria-hidden',
  'aria-label',
  'colspan',
  'rowspan'
]

const SAFE_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

const sanitizeBaseHtml = (html: string): string => {
  if (!html) {
    return ''
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_ATTR: COMMON_ALLOWED_ATTRS,
    FORBID_TAGS: FORBIDDEN_TAGS,
    KEEP_CONTENT: true,
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP
  })
}

const preserveStyleTags = (html: string): string => {
  if (!html) {
    return ''
  }

  const styleBlocks: string[] = []
  const contentWithoutStyles = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styleBlocks.push(css.replace(/[<>]/g, ''))
    return ''
  })

  const sanitizedHtml = sanitizeBaseHtml(contentWithoutStyles)
  const restoredStyles = styleBlocks.map((css) => `<style>${css}</style>`).join('')

  return `${restoredStyles}${sanitizedHtml}`
}

export const sanitizeSearchEntryPointHtml = (html: string): string => preserveStyleTags(html)
