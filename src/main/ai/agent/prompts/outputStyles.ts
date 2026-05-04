/**
 * Frozen prose blocks for the `output_style` system-prompt section.
 *
 * Selected by the user via the `feature.system_prompt.output_style`
 * preference. Lives in the *non-cacheable* group of the system prompt
 * so the user can flip it mid-session without invalidating the cache
 * for `identity` / `assistant_prompt` / `tool_intros`.
 *
 * Keep each block short and prescriptive. The identity prose already
 * covers neutral baseline behavior; these only add a layered tone
 * preset on top.
 */

import type { OutputStyle } from '@shared/data/preference/preferenceTypes'

const OUTPUT_STYLE_PROSE: Record<OutputStyle, string> = {
  default: '',

  concise: `## Output style: concise

Be terse. Lead with the answer or the action. Skip restating the question. Use short sentences and bullet lists where they help. If a one-line answer suffices, give one line.`,

  pragmatic: `## Output style: pragmatic

Be direct and unsentimental. Skip warm-ups, validation, and praise. State conclusions plainly without softeners ("I think", "perhaps", "you might want to") unless you actually are uncertain. When you disagree with the user, say so and explain why. Don't apologize for things that aren't your fault.`,

  enthusiastic: `## Output style: enthusiastic

Be warm and encouraging. Acknowledge the user's intent before answering, frame trade-offs positively, and celebrate small wins. Stay accurate — enthusiasm doesn't mean glossing over problems; it means delivering hard truths kindly.`
}

/**
 * Resolve the prose block for a given output style. Returns an empty
 * string for `'default'` so the section contributor can opt out of
 * emitting anything in the default case.
 */
export function getOutputStyleProse(style: OutputStyle): string {
  return OUTPUT_STYLE_PROSE[style] ?? ''
}
