import * as z from 'zod'

import { UniqueModelIdSchema } from '@shared/data/types/model'

import { defineRoute } from '../define'

export const cherryCloudStatusSchema = z.strictObject({
  phase: z.enum(['signed-out', 'authorizing', 'signed-in']),
  /** The signed-in account; consumers key account-scoped data by it. */
  accountId: z.string().nullable(),
  displayName: z.string().nullable()
})

export type CherryCloudStatus = z.infer<typeof cherryCloudStatusSchema>

export const cherryCloudModelFeatureSchema = z.enum(['agent', 'chat', 'translate'])

export type CherryCloudModelFeature = z.infer<typeof cherryCloudModelFeatureSchema>

const cherryCloudModelSyncResultSchema = z.strictObject({
  entitledModelIds: z.array(UniqueModelIdSchema),
  freeModelIds: z.array(UniqueModelIdSchema),
  /**
   * `agent` lists models for Work; `general` lists models for every other module. The server always
   * grants chat and translate together, so the client has no chat-only or translate-only state.
   */
  availableModelIds: z.strictObject({
    agent: z.array(UniqueModelIdSchema),
    general: z.array(UniqueModelIdSchema)
  }),
  quotaExhaustedModelIds: z.array(UniqueModelIdSchema)
})

export type CherryCloudModelSyncResult = z.infer<typeof cherryCloudModelSyncResultSchema>

const cherryCloudSubscriptionPriceSchema = z.looseObject({
  product_name: z.string(),
  currency: z.string(),
  interval: z.string(),
  unit_amount: z.number().int().nonnegative()
})

const cherryCloudPlanModelSchema = z.looseObject({
  id: z.string(),
  display_name: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  available_features: z.array(cherryCloudModelFeatureSchema)
})

const cherryCloudPlanSummarySchema = z.looseObject({
  id: z.uuid(),
  display_name: z.string().min(1),
  is_free: z.boolean(),
  default_for_new_accounts: z.boolean(),
  entitlement_duration_days: z.number().int().optional(),
  quota_pool_count: z.number().int().nonnegative(),
  model_count: z.number().int().nonnegative(),
  subscription_price: cherryCloudSubscriptionPriceSchema.optional(),
  purchase_available: z.boolean(),
  /** Catalog entries of the models the plan grants, so the client can show what subscribing unlocks. */
  models: z.array(cherryCloudPlanModelSchema).optional()
})

/** The deployment's plans and the models each grants; readable without a session. */
export const cherryCloudPublicPlanCatalogSchema = z.looseObject({
  measured_at: z.iso.datetime(),
  plans: z.array(
    z.looseObject({
      id: z.uuid(),
      display_name: z.string().min(1),
      is_free: z.boolean(),
      models: z.array(cherryCloudPlanModelSchema),
      subscription_price: cherryCloudSubscriptionPriceSchema.optional()
    })
  )
})

const cherryCloudQuotaWindowSchema = z.looseObject({
  /** `subscription_month` follows the billing period and resets at `period_end`. */
  window_type: z.enum(['rolling', 'calendar_day', 'subscription_month']),
  duration_seconds: z.number().int().positive(),
  limit_units: z.number().int().nonnegative(),
  used_units: z.number().int().nonnegative(),
  active_reserved_units: z.number().int().nonnegative(),
  remaining_units: z.number().int().nonnegative(),
  next_recovery_at: z.iso.datetime().optional(),
  period_start: z.iso.datetime().optional(),
  period_end: z.iso.datetime().optional()
})

const cherryCloudQuotaPoolSchema = z.looseObject({
  allocation_id: z.uuid(),
  display_name: z.string().min(1),
  measurement_kind: z.enum(['money', 'requests']),
  currency: z.enum(['CNY', 'USD']).optional(),
  model_ids: z.array(z.string()),
  windows: z.array(cherryCloudQuotaWindowSchema)
})

const cherryCloudPlanEntitlementSchema = z.looseObject({
  id: z.uuid(),
  source: z.string(),
  plan: cherryCloudPlanSummarySchema,
  state: z.enum(['active', 'upcoming', 'expired', 'disabled']),
  starts_at: z.iso.datetime(),
  expires_at: z.iso.datetime().optional(),
  quota_pools: z.array(cherryCloudQuotaPoolSchema)
})

export const cherryCloudAccountPlansSchema = z.looseObject({
  measured_at: z.iso.datetime(),
  entitlements: z.array(cherryCloudPlanEntitlementSchema),
  available_plans: z.array(cherryCloudPlanSummarySchema)
})

export type CherryCloudAccountPlans = z.infer<typeof cherryCloudAccountPlansSchema>
export type CherryCloudPlanModel = z.infer<typeof cherryCloudPlanModelSchema>
export type CherryCloudPublicPlanCatalog = z.infer<typeof cherryCloudPublicPlanCatalogSchema>

const subscriptionEntrySourceSchema = z.enum([
  'selector_locked_row',
  'selector_header',
  'account_panel',
  'settings',
  'quota_notice',
  'avatar_dot'
])
const quotaModelTypeSchema = z.enum(['free', 'paid'])
// One id per Subscribe click, also handed to the account portal so web and server events of the same purchase can be joined.
const subscriptionFlowIdSchema = z.uuid()

/**
 * Allow-listed subscription usage insights; none carries a price. Names shared with the China subscription web page
 * and server (`subscription_entry_clicked`, `subscription_entitlement_refresh_result`) follow their contract.
 */
export const cherryCloudAnalyticsEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ event: z.literal('subscription_entry_view'), source: subscriptionEntrySourceSchema }),
  z.strictObject({
    event: z.literal('subscription_entry_clicked'),
    source: subscriptionEntrySourceSchema,
    flowId: subscriptionFlowIdSchema,
    signedIn: z.boolean(),
    modelId: z.string().max(200).optional()
  }),
  z.strictObject({
    event: z.literal('subscription_sign_in_result'),
    flowId: subscriptionFlowIdSchema,
    // `not_completed`: the browser sign-in ended without a session (closed, cancelled, expired, or rejected).
    result: z.enum(['success', 'failed', 'not_completed']),
    reason: z.enum(['upgrade_required', 'service_unavailable', 'other']).optional()
  }),
  z.strictObject({
    event: z.literal('subscription_portal_open'),
    source: subscriptionEntrySourceSchema,
    flowId: subscriptionFlowIdSchema,
    result: z.enum(['success', 'failed'])
  }),
  z.strictObject({
    event: z.literal('subscription_entitlement_refresh_result'),
    result: z.literal('succeeded'),
    planId: z.uuid(),
    detectedBy: z.enum(['focus_refresh', 'notification']),
    sinceClick: z.enum(['under_5m', 'under_30m', 'under_24h', 'over_24h', 'none']),
    flowId: subscriptionFlowIdSchema.optional()
  }),
  z.strictObject({
    event: z.literal('subscription_quota_exhausted_view'),
    modelType: quotaModelTypeSchema,
    subscribed: z.boolean()
  }),
  z.strictObject({
    event: z.literal('subscription_quota_action'),
    action: z.enum(['subscribe', 'view_usage', 'switch_model']),
    modelType: quotaModelTypeSchema
  }),
  z.strictObject({ event: z.literal('subscription_usage_view'), subscribed: z.boolean() }),
  z.strictObject({ event: z.literal('subscription_manage_click') }),
  z.strictObject({ event: z.literal('subscription_faq_click'), subscribed: z.boolean() })
])

export type CherryCloudAnalyticsEvent = z.infer<typeof cherryCloudAnalyticsEventSchema>
export type SubscriptionEntrySource = z.infer<typeof subscriptionEntrySourceSchema>

export const cherryCloudRequestSchemas = {
  'cherry_cloud.status.get': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.account_origin.get': defineRoute({ input: z.void(), output: z.url() }),
  'cherry_cloud.login.start': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.cancel': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.session.revoke': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.models.sync': defineRoute({
    input: z.void(),
    output: cherryCloudModelSyncResultSchema
  }),
  'cherry_cloud.account_plans.get': defineRoute({ input: z.void(), output: cherryCloudAccountPlansSchema }),
  'cherry_cloud.public_plans.get': defineRoute({ input: z.void(), output: cherryCloudPublicPlanCatalogSchema }),
  'cherry_cloud.analytics.track': defineRoute({ input: cherryCloudAnalyticsEventSchema, output: z.void() })
}

export type CherryCloudEventSchemas = {
  'cherry_cloud.status_changed': CherryCloudStatus
  // A subscription notification changed entitlements; main has already refreshed the account and models.
  'cherry_cloud.account_refreshed': void
}
