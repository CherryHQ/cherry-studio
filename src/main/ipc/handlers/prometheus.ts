import { application } from '@application'
import {
  readUarAdministrationSnapshot,
  diagnoseUarAuthority,
  deleteUarProvider,
  readUarModelSources,
  readUarSettings,
  saveUarProvider,
  setDefaultUarProvider,
  testUarProvider,
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
  'prometheus.integration.start': async ({ action, workspacePath }) =>
    application.get('PrometheusIntegrationService').start(action, workspacePath),
  'prometheus.integration.cancel': async ({ id }) => application.get('PrometheusIntegrationService').cancel(id),
  'prometheus.uar.admin.snapshot': async () => readUarAdministrationSnapshot(),
  'prometheus.uar.admin.diagnose_authority': async () => diagnoseUarAuthority(),
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
