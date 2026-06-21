import type OpenAI from '@cherrystudio/openai'

/** If the model's reasoning effort could be controlled, or its reasoning behavior could be turned on/off.
 * It's basically based on OpenAI's reasoning effort, but we have adapted it for other models.
 *
 * Possible options:
 * - 'none': Disable reasoning for the model. (inherit from OpenAI)
 *            It's also used as "off" when the reasoning behavior of the model only could be set to "on" and "off".
 * - 'minimal': Enable minimal reasoning effort for the model. (inherit from OpenAI, only for few models, such as GPT-5.)
 * - 'low': Enable low reasoning effort for the model. (inherit from OpenAI)
 * - 'medium': Enable medium reasoning effort for the model. (inherit from OpenAI)
 * - 'high': Enable high reasoning effort for the model. (inherit from OpenAI)
 * - 'xhigh': Enable extra high reasoning effort for the model. (inherit from OpenAI)
 * - 'auto': Automatically determine the reasoning effort based on the model's capabilities.
 *            For some providers, it's same with 'default'.
 *            It's also used as "on" when the reasoning behavior of the model only could be set to "on" and "off".
 * - 'default': Depend on default behavior. It means we would not set any reasoning related settings when calling API.
 */
export type ReasoningEffortOption = NonNullable<OpenAI.ReasoningEffort> | 'auto' | 'default'

export type EffortRatio = Record<ReasoningEffortOption, number>

export const EFFORT_RATIO: EffortRatio = {
  // 'default' is not expected to be used.
  default: 0,
  none: 0.01,
  minimal: 0.05,
  low: 0.05,
  medium: 0.5,
  high: 0.8,
  xhigh: 0.9,
  auto: 2
}
