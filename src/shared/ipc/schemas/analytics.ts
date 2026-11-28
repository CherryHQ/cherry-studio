import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Product analytics event catalog — the only events the generic analytics route accepts.
 * Fields are camelCase on the wire and snake_case in PostHog; values are enums, numbers, booleans, or random ids,
 * never user text, names, paths, or URLs. Subscription insights keep their own contract in `cherryCloud.ts`.
 */

const flowIdSchema = z.uuid()
const durationMsSchema = z.number().int().nonnegative()

export const analyticsModelSourceSchema = z.enum(['cherry_free', 'cherry_cloud', 'cherryin', 'own_key'])
export type AnalyticsModelSource = z.infer<typeof analyticsModelSourceSchema>

const onboardingStepSchema = z.enum(['welcome', 'provider', 'select_model'])
const onboardingOptionSchema = z.enum(['cherryin_login', 'cherry_cloud_login', 'other_provider', 'skip'])
export type OnboardingAnalyticsOption = z.infer<typeof onboardingOptionSchema>

/** Events produced by renderer windows; main validates them against this union. */
export const rendererAnalyticsEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('onboarding_option_selected'), option: onboardingOptionSchema }),
  z.strictObject({
    event: z.literal('onboarding_step_viewed'),
    step: z.enum(['provider', 'select_model']),
    fromStep: onboardingStepSchema
  }),
  z.strictObject({
    event: z.literal('onboarding_completed'),
    status: z.enum(['completed', 'skipped']),
    path: z.enum(['cherryin_login', 'cherry_cloud', 'custom_provider', 'skip']),
    durationMs: durationMsSchema.optional()
  }),
  z.strictObject({ event: z.literal('cherryin_entry_view'), signedIn: z.boolean() }),
  z.strictObject({
    event: z.literal('cherryin_sign_in_result'),
    source: z.enum(['onboarding', 'provider_settings']),
    result: z.enum(['success', 'failed', 'cancelled', 'no_model']),
    durationMs: durationMsSchema
  }),
  z.strictObject({
    event: z.literal('cherryin_topup_clicked'),
    source: z.enum(['provider_settings']),
    flowId: flowIdSchema
  }),
  z.strictObject({ event: z.literal('cherryin_balance_increased'), flowId: flowIdSchema })
])
export type RendererAnalyticsEvent = z.infer<typeof rendererAnalyticsEventSchema>

/** Events produced inside the main process; typed only, since they never cross IPC. */
export type MainAnalyticsEvent =
  | { event: 'app_opened'; onboardingStatus: 'pending' | 'completed' | 'skipped' }
  | { event: 'agent_session_created'; agentKind: 'builtin' | 'custom' }
  | {
      event: 'agent_turn_finished'
      status: 'success' | 'error' | 'stopped'
      trigger: 'user' | 'headless'
      agentKind: 'builtin' | 'custom'
      modelSource: AnalyticsModelSource
      durationMs: number
      toolCallCount: number
      sessionTurnIndex: number
    }
  | { event: 'agent_created'; source: 'manual' | 'assistant_tool' }
  | { event: 'cherryin_quota_error'; composer: 'chat' | 'agent' }

export type ProductAnalyticsEvent = RendererAnalyticsEvent | MainAnalyticsEvent

export const analyticsRequestSchemas = {
  'analytics.track': defineRoute({ input: rendererAnalyticsEventSchema, output: z.void() })
}
