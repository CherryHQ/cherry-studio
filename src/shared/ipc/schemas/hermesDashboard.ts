import * as z from 'zod'

import { defineRoute } from '../define'
import { operationResultSchema } from './common'

export const HERMES_DASHBOARD_STATUSES = ['stopped', 'starting', 'running', 'error'] as const
export type HermesDashboardStatus = (typeof HERMES_DASHBOARD_STATUSES)[number]

export type HermesDashboardEventSchemas = {
  'hermes_dashboard.status_changed': { status: HermesDashboardStatus; url?: string }
}

export const HERMES_DASHBOARD_START_FAILURE_REASONS = [
  'not_installed',
  'dashboard_dependencies_missing',
  'cancelled',
  'startup_failed'
] as const
export type HermesDashboardStartFailureReason = (typeof HERMES_DASHBOARD_START_FAILURE_REASONS)[number]

const hermesDashboardStatusSchema = z.enum(HERMES_DASHBOARD_STATUSES)
const hermesDashboardStartFailureReasonSchema = z.enum(HERMES_DASHBOARD_START_FAILURE_REASONS)

export const hermesDashboardRequestSchemas = {
  'hermes_dashboard.start': defineRoute({
    input: z.void(),
    output: z.discriminatedUnion('success', [
      z.object({ success: z.literal(true), url: z.string().url() }),
      z.object({
        success: z.literal(false),
        reason: hermesDashboardStartFailureReasonSchema,
        message: z.string()
      })
    ])
  }),
  'hermes_dashboard.stop': defineRoute({
    input: z.void(),
    output: operationResultSchema
  }),
  'hermes_dashboard.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: hermesDashboardStatusSchema, url: z.string().url().optional() })
  })
}
