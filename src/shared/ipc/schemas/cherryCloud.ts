import * as z from 'zod'

import { UniqueModelIdSchema } from '@shared/data/types/model'

import { defineRoute } from '../define'

export const cherryCloudStatusSchema = z.strictObject({
  phase: z.enum(['signed-out', 'authorizing', 'signed-in']),
  displayName: z.string().nullable()
})

export type CherryCloudStatus = z.infer<typeof cherryCloudStatusSchema>

export const cherryCloudModelFeatureSchema = z.enum(['agent', 'chat', 'translate'])

export type CherryCloudModelFeature = z.infer<typeof cherryCloudModelFeatureSchema>

const cherryCloudModelSyncResultSchema = z.strictObject({
  entitledModelIds: z.array(UniqueModelIdSchema),
  freeModelIds: z.array(UniqueModelIdSchema),
  availableModelIdsByFeature: z.strictObject({
    agent: z.array(UniqueModelIdSchema),
    chat: z.array(UniqueModelIdSchema),
    translate: z.array(UniqueModelIdSchema)
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

const cherryCloudPlanSummarySchema = z.looseObject({
  id: z.uuid(),
  display_name: z.string().min(1),
  is_free: z.boolean(),
  default_for_new_accounts: z.boolean(),
  entitlement_duration_days: z.number().int().optional(),
  quota_pool_count: z.number().int().nonnegative(),
  model_count: z.number().int().nonnegative(),
  subscription_price: cherryCloudSubscriptionPriceSchema.optional(),
  purchase_available: z.boolean()
})

const cherryCloudQuotaWindowSchema = z.looseObject({
  window_type: z.enum(['rolling', 'calendar_day']),
  duration_seconds: z.number().int().positive(),
  limit_units: z.number().int().nonnegative(),
  used_units: z.number().int().nonnegative(),
  active_reserved_units: z.number().int().nonnegative(),
  remaining_units: z.number().int().nonnegative(),
  next_recovery_at: z.iso.datetime().optional()
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

export const cherryCloudRequestSchemas = {
  'cherry_cloud.status.get': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.start': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.login.cancel': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.session.revoke': defineRoute({ input: z.void(), output: cherryCloudStatusSchema }),
  'cherry_cloud.models.sync': defineRoute({
    input: z.void(),
    output: cherryCloudModelSyncResultSchema
  }),
  'cherry_cloud.account_plans.get': defineRoute({ input: z.void(), output: cherryCloudAccountPlansSchema })
}

export type CherryCloudEventSchemas = {
  'cherry_cloud.status_changed': CherryCloudStatus
}
