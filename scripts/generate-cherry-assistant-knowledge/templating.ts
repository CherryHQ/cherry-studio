/**
 * Minimal placeholder substitution for SKILL.md / agent.json templates.
 *
 * Placeholders: {{key}}. Unresolved placeholders are left untouched and reported,
 * so a missing generator is loud rather than silent.
 */

export type Language = 'zh-CN' | 'en-US'

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g

export interface RenderResult {
  output: string
  unresolved: string[]
}

export function render(template: string, values: Record<string, string>): RenderResult {
  const unresolved = new Set<string>()

  const output = template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key]
    }
    unresolved.add(key)
    return match
  })

  return { output, unresolved: [...unresolved] }
}
