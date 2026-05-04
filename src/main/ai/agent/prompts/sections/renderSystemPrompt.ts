/**
 * Render `SystemSection[]` → final `system` string for the AI SDK.
 *
 * v1 of the renderer is intentionally simple: plain `\n\n` joined
 * string. Returns `undefined` when no sections survived filtering, so
 * callers can leave `system` unset.
 *
 * TODO: emit Anthropic prompt-cache control on the last cacheable
 * section once we switch the call-site from `system: string` to a
 * structured system message form. Tracked separately from Phase B so
 * the registry rolls out without an SDK-boundary change.
 */

import type { SystemSection } from './types'

export function renderSystemPrompt(sections: SystemSection[]): string | undefined {
  if (sections.length === 0) return undefined
  return sections.map((s) => s.text).join('\n\n')
}
