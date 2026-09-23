import { application } from '@application'
import { applyPrometheusFix, runPrometheusDoctor } from '@main/services/prometheus/prometheusDoctor'
import type { prometheusRequestSchemas } from '@shared/ipc/schemas/prometheus'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const prometheusHandlers: IpcHandlersFor<typeof prometheusRequestSchemas> = {
  'prometheus.integration.snapshot': async () => application.get('PrometheusIntegrationService').snapshot(),
  'prometheus.integration.configure': async ({ config, secrets }) => application.get('PrometheusIntegrationService').configure(config, secrets),
  'prometheus.integration.start': async ({ action, workspacePath }) => application.get('PrometheusIntegrationService').start(action, workspacePath),
  'prometheus.integration.cancel': async ({ id }) => application.get('PrometheusIntegrationService').cancel(id),
  'prometheus.doctor.run': async () => runPrometheusDoctor(),
  'prometheus.doctor.fix': async ({ fixId }) => applyPrometheusFix(fixId),
  'prometheus.skills.push': async () => application.get('PrometheusSkillPushService').push(),
  'prometheus.skills.push_state': async () => application.get('PrometheusSkillPushService').getState()
}
