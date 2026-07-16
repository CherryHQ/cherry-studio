import { application } from '@application'
import { trace } from '@opentelemetry/api'
import type { Model } from '@shared/data/types/model'
import type { TelemetrySettings } from 'ai'

import { AdapterTracer, TRACER_NAME } from '../../../observability'
import type { SdkConfig } from './scope'

export interface BuildTelemetryInput {
  /** Span-attribution scope: chat topic id, or agent session id. */
  topicId: string | undefined
  requestId: string
  model: Model
  sdkConfig: SdkConfig
}

/**
 * Build telemetry settings for the request, or `undefined` to disable
 * tracing. Active iff developer mode is on AND we have a topicId to
 * attribute spans to. Input is deliberately narrow (not `RequestScope`)
 * so the AI SDK agent runtime can reuse it with its own trace context.
 */
export function buildTelemetry(input: BuildTelemetryInput): TelemetrySettings | undefined {
  const { topicId, requestId, model, sdkConfig } = input
  if (!topicId) return undefined
  const developerModeEnabled = application.get('PreferenceService').get('app.developer_mode.enabled')
  if (!developerModeEnabled) return undefined

  const modelName = model.name ?? model.id
  return {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
    tracer: new AdapterTracer(trace.getTracer(TRACER_NAME), topicId, modelName),
    functionId: `ai-request-${requestId}`,
    metadata: {
      providerId: String(sdkConfig.providerId),
      modelId: sdkConfig.modelId,
      topicId,
      modelName,
      'trace.topicId': topicId,
      'trace.modelName': modelName
    }
  }
}
