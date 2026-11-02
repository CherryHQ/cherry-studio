import type { Theme } from '../../code-highlight'

const roles = {
  keyword: 'keyword',
  comment: 'comment',
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  type: 'type',
  function: 'function',
  variable: 'variable',
  constant: 'constant',
  property: 'property',
  operator: 'operator',
  punctuation: 'punctuation',
  tag: 'tag',
  attribute: 'attribute',
  link: 'link_text',
  heading: 'title',
  emphasis: 'emphasis',
  strong: 'emphasis.strong',
  meta: 'preproc',
  invalid: 'error'
}

export function getCodeBlockPalette(theme: Theme): Record<string, string> {
  const foreground = theme.style['editor.foreground'] ?? theme.style.text ?? 'var(--foreground)'
  const player = theme.style.players?.[0]
  const palette: Record<string, string> = {
    '--code-foreground': foreground,
    '--code-background': theme.style['editor.background'] ?? theme.style.background ?? 'var(--background)',
    '--code-selection': player?.selection ?? 'var(--accent)',
    '--code-caret': player?.cursor ?? foreground
  }
  for (const [role, scope] of Object.entries(roles)) {
    const syntax = theme.style.syntax?.[scope]
    const settings = typeof syntax === 'string' ? { color: syntax } : syntax
    palette[`--code-syntax-${role}`] = settings?.color ?? foreground
    palette[`--code-syntax-${role}-style`] = settings?.font_style ?? (role === 'emphasis' ? 'italic' : 'normal')
    palette[`--code-syntax-${role}-weight`] = String(
      settings?.font_weight ?? (role === 'strong' || role === 'heading' ? 700 : 400)
    )
  }
  return palette
}
