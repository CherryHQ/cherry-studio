import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildTelemetry } from '../buildTelemetry'
import type { RequestScope } from '../scope'

function makeScope(omitTelemetryInputs?: boolean): RequestScope {
  return {
    request: { omitTelemetryInputs } as never,
    signal: undefined,
    registry: {} as never,
    assistant: undefined,
    model: { id: 'model-1', name: 'Model One' } as never,
    provider: { id: 'openai' } as never,
    capabilities: undefined,
    sdkConfig: {
      providerId: 'openai',
      providerOptionsKey: 'openai',
      providerSettings: {} as never,
      modelId: 'gpt-4o'
    },
    endpointType: undefined,
    aiSdkProviderId: 'openai',
    reasoningProfile: { format: 'none', wire: { disabled: true } },
    reasoning: { kind: 'omit', selection: 'default', emissions: [] },
    requestContext: {
      requestId: 'request-1',
      topicId: 'topic-1',
      abortSignal: new AbortController().signal
    },
    mcpToolIds: new Set()
  }
}

describe('buildTelemetry', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
  })

  it('records normal request inputs in developer mode', () => {
    expect(buildTelemetry(makeScope())?.recordInputs).toBe(true)
  })

  it('omits inputs that contain synthetic greeting context', () => {
    expect(buildTelemetry(makeScope(true))?.recordInputs).toBe(false)
  })
})
