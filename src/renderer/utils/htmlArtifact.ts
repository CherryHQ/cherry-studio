import { DomUtils, parseDocument, Parser } from 'htmlparser2'

const ACTIVE_CONTENT_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed'])
const URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'cite',
  'codebase',
  'data',
  'formaction',
  'href',
  'manifest',
  'ping',
  'poster',
  'profile',
  'src',
  'srcset'
])
const EXTERNAL_URL_PATTERN = /(?:^|[\s"'(,])(?:https?:|file:|\/\/)/i
const SCRIPT_URL_PATTERN = /^\s*(?:javascript|vbscript):/i
const ASCII_TAB_OR_NEWLINE_PATTERN = /[\t\n\r]/g
const CSS_ESCAPE_PATTERN = /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|(.))/gi

function normalizeUrlAttribute(value: string): string {
  return value.replace(ASCII_TAB_OR_NEWLINE_PATTERN, '')
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    CSS_ESCAPE_PATTERN,
    (_, hexEscape: string | undefined, lineBreak: string | undefined, escaped) => {
      if (hexEscape) {
        const codePoint = Number.parseInt(hexEscape, 16)
        return codePoint === 0 || codePoint > 0x10ffff ? '\uFFFD' : String.fromCodePoint(codePoint)
      }
      return lineBreak ? '' : (escaped ?? '')
    }
  )
}

function containsExternalUrl(value: string): boolean {
  return EXTERNAL_URL_PATTERN.test(normalizeUrlAttribute(value))
}

function containsExternalCssUrl(value: string): boolean {
  return containsExternalUrl(decodeCssEscapes(value))
}

export function htmlArtifactRequiresUserConsent(html: string): boolean {
  if (!html.trim()) return false

  try {
    let requiresUserConsent = false
    let styleDepth = 0
    const parser = new Parser(
      {
        onopentag(name, attributes) {
          if (ACTIVE_CONTENT_ELEMENTS.has(name)) {
            requiresUserConsent = true
          }
          if (name === 'style') {
            styleDepth += 1
          }
          if (name === 'meta' && attributes['http-equiv']?.toLowerCase() === 'refresh') {
            requiresUserConsent = true
          }

          for (const [attributeName, value] of Object.entries(attributes)) {
            const normalizedValue = normalizeUrlAttribute(value)
            if (attributeName.startsWith('on') || SCRIPT_URL_PATTERN.test(normalizedValue)) {
              requiresUserConsent = true
            }
            if (
              (URL_ATTRIBUTES.has(attributeName) || attributeName.endsWith(':href')) &&
              containsExternalUrl(normalizedValue)
            ) {
              requiresUserConsent = true
            }
            if (attributeName === 'style' && containsExternalCssUrl(value)) {
              requiresUserConsent = true
            }
          }
        },
        ontext(text) {
          if (styleDepth > 0 && containsExternalCssUrl(text)) {
            requiresUserConsent = true
          }
        },
        onclosetag(name) {
          if (name === 'style') {
            styleDepth = Math.max(0, styleDepth - 1)
          }
        }
      },
      {
        lowerCaseAttributeNames: true,
        lowerCaseTags: true
      }
    )

    parser.end(html)
    return requiresUserConsent
  } catch {
    return true
  }
}

/** Removes `<meta http-equiv="refresh">` tags from html. The static preview tier must
 * never auto-navigate: the navigation meta-refresh triggers needs no scripts (the
 * script-less sandbox cannot stop it) and CSP governs fetches, not navigations. */
export function stripMetaRefresh(html: string): string {
  if (!/<meta[\s/>]/i.test(html)) return html

  // Browsers close a comment at `--!>` (WHATWG comment-end-bang) while htmlparser2 only
  // recognizes `-->`: break the sequence so a comment-hidden meta cannot re-open on the
  // browser side. The zero-width space is invisible in rendered comment text.
  const normalized = html.replace(/--!>/g, '--!\u200b>')
  const document = parseDocument(normalized)
  for (const meta of DomUtils.findAll(
    (element) => element.name === 'meta' && element.attribs['http-equiv']?.toLowerCase() === 'refresh',
    document.children
  )) {
    DomUtils.removeElement(meta)
  }
  return DomUtils.getOuterHTML(document)
}
