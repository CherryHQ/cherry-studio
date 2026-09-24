import * as z from 'zod'

import type { PrometheusDoctorReport, PrometheusFixOutcome, PrometheusPushState } from '@shared/types/prometheus'
import {
  integrationActionSchema,
  integrationUpdateSchema,
  secretPatchSchema,
  uarProviderMutationSchema,
  type IntegrationOperation,
  type IntegrationSnapshot
} from '@shared/types/prometheusIntegration'
import {
  uarSettingsNamespaceSchema,
  type UarAdministrationSnapshot,
  type UarAuthorityDiagnosticResult,
  type UarModelSourceSnapshot,
  type UarSettingsSnapshot,
  type UarSettingsUpdateResult
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
    input: z.object({ updates: z.array(integrationUpdateSchema).max(4), secrets: secretPatchSchema }).strict(),
    output: z.custom<IntegrationSnapshot>()
  }),
  'prometheus.integration.start': defineRoute({
    input: z.object({ action: integrationActionSchema, workspacePath: z.string().optional() }).strict(),
    output: z.custom<IntegrationOperation>()
  }),
  'prometheus.integration.cancel': defineRoute({ input: z.object({ id: z.uuid() }).strict(), output: z.void() }),
  'prometheus.uar.admin.snapshot': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarAdministrationSnapshot>()
  }),
  'prometheus.uar.admin.diagnose_authority': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarAuthorityDiagnosticResult>()
  }),
  'prometheus.uar.settings.read': defineRoute({
    input: z.object({ namespace: uarSettingsNamespaceSchema }).strict(),
    output: z.custom<UarSettingsSnapshot>()
  }),
  'prometheus.uar.settings.update': defineRoute({
    input: z
      .object({
        namespace: uarSettingsNamespaceSchema,
        changes: z
          .array(
            z
              .object({
                field: z
                  .string()
                  .regex(/^[a-zA-Z0-9_.-]+$/)
                  .max(128),
                value: z.unknown(),
                expectedRevision: z.string().min(1).max(128)
              })
              .strict()
          )
          .min(1)
          .max(128)
      })
      .strict(),
    output: z.custom<UarSettingsUpdateResult>()
  }),
  'prometheus.uar.models.sources': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarModelSourceSnapshot>()
  }),
  'prometheus.uar.providers.save': defineRoute({
    input: uarProviderMutationSchema,
    output: z.custom<UarModelSourceSnapshot>()
  }),
  'prometheus.uar.providers.delete': defineRoute({
    input: z.object({ id: z.string().min(1).max(128) }).strict(),
    output: z.custom<UarModelSourceSnapshot>()
  }),
  'prometheus.uar.providers.default': defineRoute({
    input: z.object({ id: z.string().min(1).max(128) }).strict(),
    output: z.custom<UarModelSourceSnapshot>()
  }),
  'prometheus.uar.providers.test': defineRoute({
    input: z.object({ id: z.string().min(1).max(128), modelId: z.string().min(1).max(256) }).strict(),
    output: z.object({ ok: z.boolean(), providerId: z.string(), modelId: z.string(), latencyMs: z.number() })
  }),
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
