import { Parser } from 'htmlparser2'

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
            if (attributeName.startsWith('on') || SCRIPT_URL_PATTERN.test(value)) {
              requiresUserConsent = true
            }
            if (
              (URL_ATTRIBUTES.has(attributeName) || attributeName.endsWith(':href')) &&
              EXTERNAL_URL_PATTERN.test(value)
            ) {
              requiresUserConsent = true
            }
            if (attributeName === 'style' && EXTERNAL_URL_PATTERN.test(value)) {
              requiresUserConsent = true
            }
          }
        },
        ontext(text) {
          if (styleDepth > 0 && EXTERNAL_URL_PATTERN.test(text)) {
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
