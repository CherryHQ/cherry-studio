import { application } from '@application'
import {
  compileUarAgent,
  cancelUarRun,
  createUarKnowledgeBase,
  createUarMemory,
  deleteUarA2uiComponent,
  deleteUarAgent,
  deleteUarArtifactSchema,
  deleteUarPresentation,
  deleteUarKnowledgeBase,
  deleteUarKnowledgeDocument,
  deleteUarMemory,
  deleteUarProvider,
  diagnoseUarAuthority,
  readUarAdministrationSnapshot,
  readUarOperations,
  readUarRunDetail,
  readUarCatalog,
  prepareUarAgentRun,
  readUarModelSources,
  readUarPresentations,
  readUarSettings,
  refreshUarSkills,
  saveUarA2uiComponent,
  saveUarAgent,
  saveUarAgentSkills,
  saveUarArtifactSchema,
  saveUarFederatedAgent,
  saveUarPresentation,
  saveUarPresentationPolicy,
  saveUarConversationPolicy,
  saveUarProvider,
  searchUarKnowledge,
  uploadUarKnowledgeDocument,
  setDefaultUarProvider,
  testUarProvider,
  toggleUarSkill,
  updateUarSettings
} from '@main/ai/runtime/uar'
import { StaleIntegrationRevisionError } from '@main/services/prometheus/integrationErrors'
import { applyPrometheusFix, runPrometheusDoctor } from '@main/services/prometheus/prometheusDoctor'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { prometheusErrorCodes } from '@shared/ipc/errors/prometheus'
import type { prometheusRequestSchemas } from '@shared/ipc/schemas/prometheus'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const prometheusHandlers: IpcHandlersFor<typeof prometheusRequestSchemas> = {
  'prometheus.integration.snapshot': async () => application.get('PrometheusIntegrationService').snapshot(),
  'prometheus.integration.configure': async ({ updates, secrets }) => {
    try {
      return await application.get('PrometheusIntegrationService').configure(updates, secrets)
    } catch (error) {
      if (error instanceof StaleIntegrationRevisionError) {
        throw new IpcError(prometheusErrorCodes.STALE_INTEGRATION_REVISION, error.message, {
          feature: error.feature,
          expected: error.expected,
          current: error.current
        })
      }
      throw error
    }
  },
  'prometheus.integration.workspace_enabled': async ({ workspacePath, enabled }) =>
    application.get('PrometheusIntegrationService').setWorkspaceEnabled(workspacePath, enabled),
  'prometheus.integration.start': async ({ action, workspacePath }) =>
    application.get('PrometheusIntegrationService').start(action, workspacePath),
  'prometheus.integration.cancel': async ({ id }) => application.get('PrometheusIntegrationService').cancel(id),
  'prometheus.integration.operation_events': async ({ id, after, limit }) =>
    application.get('PrometheusIntegrationService').operationEvents(id, after, limit),
  'prometheus.integration.operation_log': async ({ id, offset, limit }) =>
    application.get('PrometheusIntegrationService').readOperationLog(id, offset, limit),
  'prometheus.integration.export_log': async ({ id }) =>
    application.get('PrometheusIntegrationService').exportOperationLog(id),
  'prometheus.uar.admin.snapshot': async () => readUarAdministrationSnapshot(),
  'prometheus.uar.admin.diagnose_authority': async () => diagnoseUarAuthority(),
  'prometheus.uar.operations.read': async () => readUarOperations(),
  'prometheus.uar.runs.read': async ({ runId }) => readUarRunDetail(runId),
  'prometheus.uar.runs.cancel': async ({ runId }) => cancelUarRun(runId),
  'prometheus.uar.runs.save_policy': async ({ runId, policy }) => saveUarConversationPolicy(runId, policy),
  'prometheus.uar.runs.reset_policy': async ({ runId }) => saveUarConversationPolicy(runId),
  'prometheus.uar.knowledge.create': async (input) => createUarKnowledgeBase(input),
  'prometheus.uar.knowledge.delete': async ({ sessionId, knowledgeBaseId }) =>
    deleteUarKnowledgeBase(sessionId, knowledgeBaseId),
  'prometheus.uar.knowledge.search': async (input) => searchUarKnowledge(input),
  'prometheus.uar.knowledge.upload': async ({ sessionId, knowledgeBaseId }) =>
    uploadUarKnowledgeDocument(sessionId, knowledgeBaseId),
  'prometheus.uar.knowledge.delete_document': async ({ sessionId, knowledgeBaseId, documentId }) =>
    deleteUarKnowledgeDocument(sessionId, knowledgeBaseId, documentId),
  'prometheus.uar.memory.create': async ({ content, userId }) => createUarMemory(content, userId),
  'prometheus.uar.memory.delete': async ({ id }) => deleteUarMemory(id),
  'prometheus.uar.catalog.read': async () => readUarCatalog(),
  'prometheus.uar.catalog.save_agent': async (input) => saveUarAgent(input),
  'prometheus.uar.catalog.prepare_run': async (input) => prepareUarAgentRun(input),
  'prometheus.uar.catalog.delete_agent': async ({ id }) => deleteUarAgent(id),
  'prometheus.uar.catalog.compile': async (input) => compileUarAgent(input),
  'prometheus.uar.catalog.save_agent_skills': async ({ agentId, skillIds }) => saveUarAgentSkills(agentId, skillIds),
  'prometheus.uar.catalog.toggle_skill': async ({ skillId, enabled }) => toggleUarSkill(skillId, enabled),
  'prometheus.uar.catalog.refresh_skills': async () => refreshUarSkills(),
  'prometheus.uar.catalog.save_federated_agent': async (input) => saveUarFederatedAgent(input),
  'prometheus.uar.presentations.read': async () => readUarPresentations(),
  'prometheus.uar.presentations.save': async (input) => saveUarPresentation(input),
  'prometheus.uar.presentations.delete': async ({ id, expectedRevision }) =>
    deleteUarPresentation(id, expectedRevision),
  'prometheus.uar.presentations.save_schema': async (input) => saveUarArtifactSchema(input),
  'prometheus.uar.presentations.delete_schema': async ({ schemaId, expectedRevision }) =>
    deleteUarArtifactSchema(schemaId, expectedRevision),
  'prometheus.uar.presentations.save_component': async (input) => saveUarA2uiComponent(input),
  'prometheus.uar.presentations.delete_component': async ({ id, expectedRevision }) =>
    deleteUarA2uiComponent(id, expectedRevision),
  'prometheus.uar.presentations.save_policy': async ({ expectedPolicy, selection }) =>
    saveUarPresentationPolicy(expectedPolicy, selection),
  'prometheus.uar.settings.read': async ({ namespace }) => readUarSettings(namespace),
  'prometheus.uar.settings.update': async ({ namespace, changes }) => updateUarSettings(namespace, changes),
  'prometheus.uar.models.sources': async () => readUarModelSources(),
  'prometheus.uar.providers.save': async (input) => saveUarProvider(input),
  'prometheus.uar.providers.delete': async ({ id }) => deleteUarProvider(id),
  'prometheus.uar.providers.default': async ({ id }) => setDefaultUarProvider(id),
  'prometheus.uar.providers.test': async ({ id, modelId }) => testUarProvider(id, modelId),
  'prometheus.doctor.run': async () => runPrometheusDoctor(),
  'prometheus.doctor.fix': async ({ fixId }) => applyPrometheusFix(fixId),
  'prometheus.skills.push': async () => application.get('PrometheusSkillPushService').push(),
  'prometheus.skills.push_state': async () => application.get('PrometheusSkillPushService').getState()
}
