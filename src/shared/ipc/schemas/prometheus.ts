import * as z from 'zod'

import {
  literConfigEditSchema,
  literConfigSourceSchema,
  type LiterConfigApplyResult,
  type LiterConfigExportResult,
  type LiterConfigPreview,
  type LiterConfigSourceSelection,
  type LiterConfigSnapshot
} from '@shared/types/literConfig'
import {
  literAliasMutationSchema,
  literConnectionMutationSchema,
  literGatewaySelectionSchema,
  type LiterGatewayCatalogSnapshot
} from '@shared/types/literGateway'
import type { PrometheusDoctorReport, PrometheusFixOutcome, PrometheusPushState } from '@shared/types/prometheus'
import {
  integrationActionSchema,
  integrationUpdateSchema,
  secretPatchSchema,
  uarA2uiComponentSaveSchema,
  uarAgentSaveSchema,
  uarAgentRunTargetSchema,
  uarAgentSkillsSchema,
  uarArtifactSchemaSaveSchema,
  uarCompilerRequestSchema,
  uarFederatedAgentSaveSchema,
  uarPresentationSaveSchema,
  uarPresentationSelectionSchema,
  uarKnowledgeCreateSchema,
  uarKnowledgeSearchSchema,
  uarMemoryCreateSchema,
  uarProviderMutationSchema,
  uarSkillToggleSchema,
  type IntegrationOperation,
  type IntegrationOperationEvent,
  type IntegrationOperationEventPage,
  type IntegrationOperationLogExport,
  type IntegrationOperationLogPage,
  type IntegrationSnapshot,
  type WorkspaceIntegration
} from '@shared/types/prometheusIntegration'
import {
  uarSettingsNamespaceSchema,
  type UarAdministrationSnapshot,
  type UarAgentRunTarget,
  type UarCatalogSnapshot,
  type UarCompilerResult,
  type UarAuthorityDiagnosticResult,
  type UarModelSourceSnapshot,
  type UarKnowledgeSearchResult,
  type UarKnowledgeUploadResult,
  type UarOperationalSnapshot,
  type UarPresentationAdministrationSnapshot,
  type UarRunDetailSnapshot,
  type UarSettingsSnapshot,
  type UarSettingsUpdateResult
} from '@shared/types/prometheusIntegration'

import { defineRoute } from '../define'

const literRemoteEndpointSchema = z.url().refine((value) => {
  const endpoint = new URL(value)
  return /^https?:$/.test(endpoint.protocol) && !endpoint.username && !endpoint.password
})

/**
 * The Prometheus settings section's commands.
 *
 * Unlike the native Doctor, results come back on the response rather than through the shared
 * cache: the pack's `scripts/doctor.mjs` buffers every check and prints them together at the end,
 * so there is no partial state to stream. Adding a cache key would imply progress the underlying
 * process cannot report.
 */
export const prometheusRequestSchemas = {
  'prometheus.liter_config.select_local': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<LiterConfigSourceSelection>()
  }),
  'prometheus.liter_config.read': defineRoute({
    input: z.object({ source: literConfigSourceSchema }).strict(),
    output: z.custom<LiterConfigSnapshot>()
  }),
  'prometheus.liter_config.preview': defineRoute({
    input: z
      .object({
        source: literConfigSourceSchema,
        expectedRevision: z.string().length(64),
        edits: z.array(literConfigEditSchema).max(4096)
      })
      .strict(),
    output: z.custom<LiterConfigPreview>()
  }),
  'prometheus.liter_config.preview_saved': defineRoute({
    input: z.object({ source: literConfigSourceSchema, expectedRevision: z.string().length(64) }).strict(),
    output: z.custom<LiterConfigPreview>()
  }),
  'prometheus.liter_config.apply': defineRoute({
    input: z
      .object({
        source: literConfigSourceSchema,
        expectedRevision: z.string().length(64),
        edits: z.array(literConfigEditSchema).max(4096)
      })
      .strict(),
    output: z.custom<LiterConfigApplyResult>()
  }),
  'prometheus.liter_config.apply_saved': defineRoute({
    input: z.object({ source: literConfigSourceSchema, expectedRevision: z.string().length(64) }).strict(),
    output: z.custom<LiterConfigApplyResult>()
  }),
  'prometheus.liter_config.export': defineRoute({
    input: z
      .object({
        source: literConfigSourceSchema,
        expectedRevision: z.string().length(64),
        edits: z.array(literConfigEditSchema).max(4096),
        remoteEndpoint: literRemoteEndpointSchema.optional()
      })
      .strict(),
    output: z.custom<LiterConfigExportResult>()
  }),
  'prometheus.liter_config.export_saved': defineRoute({
    input: z
      .object({
        source: literConfigSourceSchema,
        expectedRevision: z.string().length(64),
        remoteEndpoint: literRemoteEndpointSchema.optional()
      })
      .strict(),
    output: z.custom<LiterConfigExportResult>()
  }),
  'prometheus.liter.catalog.read': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.catalog.refresh': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.gateway.select': defineRoute({
    input: literGatewaySelectionSchema,
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.connections.save': defineRoute({
    input: literConnectionMutationSchema,
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.connections.delete': defineRoute({
    input: z
      .object({
        providerConnectionId: z.string().min(1).max(128),
        expectedRevision: z.number().int().nonnegative()
      })
      .strict(),
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.aliases.save': defineRoute({
    input: literAliasMutationSchema,
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.liter.aliases.delete': defineRoute({
    input: z
      .object({
        gatewayConnectionId: z.string().min(1).max(128),
        alias: z.string().min(1).max(256),
        expectedRevision: z.number().int().nonnegative()
      })
      .strict(),
    output: z.custom<LiterGatewayCatalogSnapshot>()
  }),
  'prometheus.integration.snapshot': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<IntegrationSnapshot>()
  }),
  'prometheus.integration.configure': defineRoute({
    input: z.object({ updates: z.array(integrationUpdateSchema).max(4), secrets: secretPatchSchema }).strict(),
    output: z.custom<IntegrationSnapshot>()
  }),
  'prometheus.integration.workspace_enabled': defineRoute({
    input: z.object({ workspacePath: z.string().min(1), enabled: z.boolean() }).strict(),
    output: z.custom<WorkspaceIntegration>()
  }),
  'prometheus.integration.start': defineRoute({
    input: z.object({ action: integrationActionSchema, workspacePath: z.string().optional() }).strict(),
    output: z.custom<IntegrationOperation>()
  }),
  'prometheus.integration.cancel': defineRoute({ input: z.object({ id: z.uuid() }).strict(), output: z.void() }),
  'prometheus.integration.operation_events': defineRoute({
    input: z
      .object({
        id: z.uuid(),
        after: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(500).optional()
      })
      .strict(),
    output: z.custom<IntegrationOperationEventPage>()
  }),
  'prometheus.integration.operation_log': defineRoute({
    input: z
      .object({
        id: z.uuid(),
        offset: z.number().int().nonnegative().optional(),
        limit: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024)
          .optional()
      })
      .strict(),
    output: z.custom<IntegrationOperationLogPage>()
  }),
  'prometheus.integration.export_log': defineRoute({
    input: z.object({ id: z.uuid() }).strict(),
    output: z.custom<IntegrationOperationLogExport>()
  }),
  'prometheus.uar.admin.snapshot': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarAdministrationSnapshot>()
  }),
  'prometheus.uar.admin.diagnose_authority': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarAuthorityDiagnosticResult>()
  }),
  'prometheus.uar.operations.read': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.runs.read': defineRoute({
    input: z.object({ runId: z.string().min(1).max(256) }).strict(),
    output: z.custom<UarRunDetailSnapshot>()
  }),
  'prometheus.uar.runs.cancel': defineRoute({
    input: z.object({ runId: z.string().min(1).max(256) }).strict(),
    output: z.custom<UarRunDetailSnapshot>()
  }),
  'prometheus.uar.runs.save_policy': defineRoute({
    input: z.object({ runId: z.string().min(1).max(256), policy: z.record(z.string(), z.unknown()) }).strict(),
    output: z.custom<UarRunDetailSnapshot>()
  }),
  'prometheus.uar.runs.reset_policy': defineRoute({
    input: z.object({ runId: z.string().min(1).max(256) }).strict(),
    output: z.custom<UarRunDetailSnapshot>()
  }),
  'prometheus.uar.knowledge.create': defineRoute({
    input: uarKnowledgeCreateSchema,
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.knowledge.delete': defineRoute({
    input: z.object({ sessionId: z.string().min(1), knowledgeBaseId: z.string().min(1) }).strict(),
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.knowledge.search': defineRoute({
    input: uarKnowledgeSearchSchema,
    output: z.custom<UarKnowledgeSearchResult[]>()
  }),
  'prometheus.uar.knowledge.upload': defineRoute({
    input: z.object({ sessionId: z.string().min(1), knowledgeBaseId: z.string().min(1) }).strict(),
    output: z.custom<UarKnowledgeUploadResult>()
  }),
  'prometheus.uar.knowledge.delete_document': defineRoute({
    input: z
      .object({ sessionId: z.string().min(1), knowledgeBaseId: z.string().min(1), documentId: z.string().min(1) })
      .strict(),
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.memory.create': defineRoute({
    input: uarMemoryCreateSchema,
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.memory.delete': defineRoute({
    input: z.object({ id: z.string().min(1).max(512) }).strict(),
    output: z.custom<UarOperationalSnapshot>()
  }),
  'prometheus.uar.catalog.read': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.save_agent': defineRoute({
    input: uarAgentSaveSchema,
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.prepare_run': defineRoute({
    input: uarAgentRunTargetSchema,
    output: z.custom<UarAgentRunTarget>()
  }),
  'prometheus.uar.catalog.delete_agent': defineRoute({
    input: z.object({ id: z.string().min(1).max(256) }).strict(),
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.compile': defineRoute({
    input: uarCompilerRequestSchema,
    output: z.custom<UarCompilerResult>()
  }),
  'prometheus.uar.catalog.save_agent_skills': defineRoute({
    input: uarAgentSkillsSchema,
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.toggle_skill': defineRoute({
    input: uarSkillToggleSchema,
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.refresh_skills': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.catalog.save_federated_agent': defineRoute({
    input: uarFederatedAgentSaveSchema,
    output: z.custom<UarCatalogSnapshot>()
  }),
  'prometheus.uar.presentations.read': defineRoute({
    input: z.object({}).strict(),
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.save': defineRoute({
    input: uarPresentationSaveSchema,
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.delete': defineRoute({
    input: z.object({ id: z.string().min(1).max(256), expectedRevision: z.number().int().nonnegative() }).strict(),
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.save_schema': defineRoute({
    input: uarArtifactSchemaSaveSchema,
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.delete_schema': defineRoute({
    input: z.object({ schemaId: z.string().min(1).max(256), expectedRevision: z.string().min(1).max(128) }).strict(),
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.save_component': defineRoute({
    input: uarA2uiComponentSaveSchema,
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.delete_component': defineRoute({
    input: z.object({ id: z.string().min(1).max(256), expectedRevision: z.string().min(1).max(128) }).strict(),
    output: z.custom<UarPresentationAdministrationSnapshot>()
  }),
  'prometheus.uar.presentations.save_policy': defineRoute({
    input: z
      .object({ expectedPolicy: z.record(z.string(), z.unknown()), selection: uarPresentationSelectionSchema })
      .strict(),
    output: z.custom<UarPresentationAdministrationSnapshot>()
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

export type PrometheusEventSchemas = {
  'prometheus.integration.operation_progress': IntegrationOperationEvent
}
