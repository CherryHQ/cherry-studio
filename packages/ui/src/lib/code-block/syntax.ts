import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const CODE_BLOCK_SYNTAX = [
  { role: 'keyword', tag: tags.keyword },
  { role: 'comment', tag: tags.comment },
  { role: 'string', tag: [tags.string, tags.regexp, tags.escape] },
  { role: 'number', tag: tags.number },
  { role: 'boolean', tag: [tags.bool, tags.null] },
  { role: 'type', tag: [tags.typeName, tags.className, tags.namespace] },
  { role: 'function', tag: [tags.function(tags.variableName), tags.function(tags.propertyName)] },
  { role: 'variable', tag: tags.variableName },
  { role: 'constant', tag: tags.constant(tags.variableName) },
  { role: 'property', tag: tags.propertyName },
  { role: 'operator', tag: tags.operator },
  { role: 'punctuation', tag: tags.punctuation },
  { role: 'tag', tag: tags.tagName },
  { role: 'attribute', tag: tags.attributeName },
  { role: 'link', tag: tags.link },
  { role: 'heading', tag: tags.heading },
  { role: 'emphasis', tag: tags.emphasis },
  { role: 'strong', tag: tags.strong },
  { role: 'meta', tag: tags.meta },
  { role: 'invalid', tag: tags.invalid }
] as const

export const codeBlockHighlightStyle = HighlightStyle.define(
  CODE_BLOCK_SYNTAX.map(({ role, tag }) => ({ tag, class: `code-syntax-${role}` }))
)

export const codeBlockSyntaxCss =
  '.code-viewer ::selection,.code-syntax-root ::selection{background:var(--code-selection)}' +
  CODE_BLOCK_SYNTAX.map(
    ({ role }) =>
      `.code-syntax-${role}{color:var(--code-syntax-${role},inherit);font-style:var(--code-syntax-${role}-style,normal);font-weight:var(--code-syntax-${role}-weight,normal)}`
  ).join('')
