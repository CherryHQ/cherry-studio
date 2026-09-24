import * as z from 'zod'

import type { PrometheusDoctorReport, PrometheusFixOutcome, PrometheusPushState } from '@shared/types/prometheus'
import {
  integrationActionSchema,
  integrationUpdateSchema,
  secretPatchSchema,
  type IntegrationOperation,
  type IntegrationSnapshot
} from '@shared/types/prometheusIntegration'

import { defineRoute } from '../define'

/**
 * The Prometheus settings section's commands.
 *
 * Unlike the native Doctor, results come back on the response rather than through the shared
 * cache: the pack's `scripts/doctor.mjs` buffers every check and prints them together at the end,
 * so there is no partial state to stream. Adding a cache key would imply progress the underlying
 * process cannot report.
 */
export const prometheusRequestSchemas = {
  'prometheus.integration.snapshot': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<IntegrationSnapshot>()
  }),
  'prometheus.integration.configure': defineRoute({
    input: z.object({ updates: z.array(integrationUpdateSchema).max(3), secrets: secretPatchSchema }).strict(),
    output: z.custom<IntegrationSnapshot>()
  }),
  'prometheus.integration.start': defineRoute({
    input: z.object({ action: integrationActionSchema, workspacePath: z.string().optional() }).strict(),
    output: z.custom<IntegrationOperation>()
  }),
  'prometheus.integration.cancel': defineRoute({ input: z.object({ id: z.uuid() }).strict(), output: z.void() }),
  'prometheus.doctor.run': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<PrometheusDoctorReport>()
  }),
  'prometheus.doctor.fix': defineRoute({
    // The pack rejects an unknown fix id itself; this only bounds the input's shape.
    input: z.object({ fixId: z.string().min(1).max(64) }).strict(),
    output: z.custom<PrometheusFixOutcome>()
  }),
  'prometheus.skills.push': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<PrometheusPushState>()
  }),
  'prometheus.skills.push_state': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<PrometheusPushState>()
  })
}
