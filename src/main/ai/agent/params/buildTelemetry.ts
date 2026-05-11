import { application } from '@main/core/application'
import { trace } from '@opentelemetry/api'
import type { TelemetrySettings } from 'ai'

import { AdapterTracer, TRACER_NAME } from '../../trace'
import type { RequestScope } from './scope'

/**
 * Build telemetry settings for the request, or `undefined` to disable
 * tracing. Active iff developer mode is on AND we have a topicId to
 * attribute spans to.
 */
export function buildTelemetry(scope: RequestScope): TelemetrySettings | undefined {
  const topicId = scope.requestContext.topicId
  if (!topicId) return undefined
  const developerModeEnabled = application.get('PreferenceService').get('app.developer_mode.enabled')
  if (!developerModeEnabled) return undefined

  const modelName = scope.model.name ?? scope.model.id
  return {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
    tracer: new AdapterTracer(trace.getTracer(TRACER_NAME), topicId, modelName),
    functionId: `ai-request-${scope.requestContext.requestId}`,
    metadata: {
      providerId: String(scope.sdkConfig.providerId),
      modelId: scope.sdkConfig.modelId,
      topicId,
      modelName,
      'trace.topicId': topicId,
      'trace.modelName': modelName
    }
  }
}
