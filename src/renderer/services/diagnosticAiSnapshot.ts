import { cacheService } from '@data/CacheService'
import type { AppErrorContext } from '@shared/types/appError'
import type { DiagnosticAiDiagnosis } from '@shared/types/diagnosticAi'
import type { DoctorScopeKey } from '@shared/types/doctor'
import type { DoctorAgentIncident, DoctorAgentRun, DoctorAgentState } from '@shared/types/doctorAgent'
import { projectDiagnosticAiDiagnosis } from '@shared/utils/diagnosticAi'
import {
  doctorAgentKey,
  doctorAgentStateCacheKey,
  doctorStateCacheKey,
  isOperationIncident
} from '@shared/utils/doctor'

export interface DiagnosticAiSnapshotInput {
  readonly scope: DoctorScopeKey
  readonly incident?: DoctorAgentIncident
  readonly errorContext?: AppErrorContext
}

function incidentsMatch(expected: DoctorAgentIncident | undefined, actual: DoctorAgentIncident | undefined): boolean {
  if (expected === undefined) return actual === undefined
  if (actual === undefined) return false
  if (isOperationIncident(expected) || isOperationIncident(actual)) {
    return isOperationIncident(expected) && isOperationIncident(actual) && expected.context.id === actual.context.id
  }
  return (
    expected.topicId === actual.topicId &&
    expected.messageId === actual.messageId &&
    expected.errorId === actual.errorId
  )
}

function incidentMatchesFault(incident: DoctorAgentIncident | undefined, faultId: string): boolean {
  if (!incident) return false
  if (isOperationIncident(incident)) return incident.context.id === faultId
  return incident.errorId === faultId
}

function attachableRun(state: DoctorAgentState):
  | {
      readonly status: 'completed' | 'failed' | 'canceled'
      readonly text: string
      readonly scope: DoctorAgentRun['scope']
      readonly runId: string
      readonly reportRunId: string
      readonly modelId: string
      readonly startedAt: string
      readonly incident?: DoctorAgentIncident
    }
  | undefined {
  switch (state.status) {
    case 'completed':
    case 'canceled':
    case 'failed': {
      const text = state.text.trim()
      if (text.length === 0) return undefined
      return {
        status: state.status,
        text: state.text,
        scope: state.scope,
        runId: state.runId,
        reportRunId: state.reportRunId,
        modelId: state.modelId,
        startedAt: state.startedAt,
        incident: state.incident
      }
    }
    default:
      return undefined
  }
}

/**
 * Copy of the AI text currently cached for this scope and incident.
 * A contextual fault never reads the global analysis. Idle, running, empty, and stale runs are ignored.
 */
export function captureDiagnosticAiDiagnosis(input: DiagnosticAiSnapshotInput): DiagnosticAiDiagnosis | undefined {
  const faultId = input.errorContext?.id
  if (faultId && !incidentMatchesFault(input.incident, faultId)) return undefined

  const doctorState = cacheService.getShared(doctorStateCacheKey(input.scope))
  if (doctorState?.status !== 'completed') return undefined

  const agentState = cacheService.getShared(doctorAgentStateCacheKey(doctorAgentKey(input.scope, input.incident)))
  const run = agentState ? attachableRun(agentState) : undefined
  if (!run) return undefined
  if (run.scope !== input.scope || run.reportRunId !== doctorState.report.runId) return undefined
  if (!incidentsMatch(input.incident, run.incident)) return undefined

  const messageIncident = input.incident && !isOperationIncident(input.incident) ? input.incident : undefined
  return projectDiagnosticAiDiagnosis({
    source: 'doctor-agent',
    status: run.status,
    text: run.text,
    scope: run.scope,
    runId: run.runId,
    reportRunId: run.reportRunId,
    modelId: run.modelId,
    startedAt: run.startedAt,
    ...(faultId ? { errorId: faultId } : {}),
    ...(messageIncident ? { topicId: messageIncident.topicId, messageId: messageIncident.messageId } : {})
  })
}
