import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import enUS from '@renderer/i18n/locales/en-us.json'
import type { SerializedError } from '@renderer/types/error'
import type { InputFor } from '@shared/ipc/types'

import { classifyErrorByAI, diagnoseError } from '../errorDiagnosis'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: keyof typeof enUS) => enUS[key] }
}))

const { mockIpcRequest } = vi.hoisted(() => ({ mockIpcRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mockIpcRequest }
}))

const unavailable = enUS['error.diagnosis.default_model_unavailable']
const diagnosisUnavailable = enUS['error.diagnosis.free_model_unavailable']
const defaultModel = { id: 'custom-provider::custom-model', providerId: 'custom-provider', isEnabled: true }

function makeError(overrides: Partial<SerializedError> = {}): SerializedError {
  return { name: 'Error', message: 'test error', stack: null, ...overrides }
}

function respondWith(text: string) {
  mockIpcRequest.mockResolvedValue({ text })
}

function requestInput(): InputFor<'ai.text.generate'> {
  return mockIpcRequest.mock.calls[0][1]
}

describe('Error diagnosis', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await preferenceService.set('app.privacy.data_collection.enabled', true)
    await preferenceService.set('chat.default_model_id', defaultModel.id)
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path === `/models/${defaultModel.id}`) return defaultModel
      if (path === `/providers/${defaultModel.providerId}`) return { isEnabled: true }
      return undefined
    })
  })

  describe('diagnoseError', () => {
    it.each(['Request payload is too large', '413 Failed to buffer the request body: length limit exceeded'])(
      'selects request-size guidance for %s',
      async (message) => {
        respondWith(
          JSON.stringify({ summary: 'Request too large', category: 'payload', explanation: 'Too large', steps: [] })
        )
        await diagnoseError(makeError({ message }), 'en')
        const args = requestInput()
        const context = args.system?.split('## Context\n')[1]?.split('\n')[0]
        expect(context).toContain('request payload is too large')
        expect(context).toContain('removing large attachments')
        expect(JSON.parse(args.prompt as string).message).toBe(message)
      }
    )

    it.each([
      'Response payload is too large',
      'Response payload too large',
      'Response body payload is too large',
      'Response body payload too large',
      'Response  payload is too large'
    ])('does not prescribe request-size recovery for %s', async (message) => {
      respondWith(
        JSON.stringify({ summary: 'Response too large', category: 'unknown', explanation: 'Too large', steps: [] })
      )
      await diagnoseError(makeError({ message }), 'en')
      const args = requestInput()
      const context = args.system?.split('## Context\n')[1]?.split('\n')[0]
      expect(context).toBeDefined()
      expect(context).not.toContain('request payload is too large')
      expect(context).not.toContain('removing large attachments')
      expect(JSON.parse(args.prompt as string).message).toBe(message)
    })

    it.each([
      'pi-ai provider "native-route" has no configured model "glm-5"',
      'NO_ADAPTER: no adapter registered for provider "native-route"'
    ])('diagnoses the native CLI catalog rather than Cherry model settings: %s', async (message) => {
      const result = await diagnoseError(makeError({ message }), 'en')
      expect(result.category).toBe('model')
      expect(result.explanation).toContain('native configuration')
      expect(result.explanation).toContain('does not mean the model is missing from Cherry Studio')
      expect(result.steps[0].text).toContain('CLI')
      expect(mockIpcRequest).not.toHaveBeenCalled()
    })

    it.each([
      [
        `service_tier auto is not available for this org. You can check your plan at
[Billing - Plans](https://console.groq.com/settings/billing/plans), and upgrade to access the
required service tier.`,
        false
      ],
      ['insufficient_quota', true]
    ] as const)('gives the correct Context for %s', async (message, quota) => {
      respondWith(JSON.stringify({ summary: 'x', category: 'permission', explanation: 'x', steps: [] }))
      await diagnoseError(makeError({ message, statusCode: 400 }), 'en', { providerId: 'groq' })
      const prompt = requestInput().system
      const context = prompt?.split('## Context\n')[1]?.split('\n')[0]
      if (quota) {
        expect(context).toBe(
          "The user's quota or account balance is exhausted on groq. Suggest checking billing on the provider's website, topping up, or switching to a different provider. DO NOT suggest waiting or retrying - this is not a transient issue."
        )
      } else {
        expect(context).toBe(
          "Groq rejected the selected service tier because it is not available for this organization. Suggest opening Response settings > Service tier in the chat composer and selecting Standard (on_demand), or checking the organization's plan and service-tier access in Groq Billing > Plans. This message does not establish quota or balance exhaustion or an invalid API key. Do not recommend topping up or regenerating the key based on this message. Do not promise that changing tiers will make the request succeed."
        )
        expect(context).not.toContain('quota or account balance is exhausted')
      }
    })

    it('returns parsed diagnosis result from AI', async () => {
      const mockResult = {
        summary: 'Auth error',
        category: 'authentication',
        explanation: 'Your API key is invalid.',
        steps: [{ text: 'Check your API key', nav: '/settings/provider' }]
      }
      respondWith(JSON.stringify(mockResult))

      const result = await diagnoseError(makeError(), 'en')
      expect(result.summary).toBe('Auth error')
      expect(result.category).toBe('authentication')
      expect(result.steps).toHaveLength(1)
    })

    it('strips markdown code blocks from response', async () => {
      const mockResult = {
        summary: 'Network error',
        category: 'network',
        explanation: 'Connection refused.',
        steps: [{ text: 'Check proxy' }]
      }
      respondWith('```json\n' + JSON.stringify(mockResult) + '\n```')

      const result = await diagnoseError(makeError(), 'en')
      expect(result.summary).toBe('Network error')
    })

    it('explains that diagnosis needs an available default model when it returns an empty response', async () => {
      respondWith('')
      await expect(diagnoseError(makeError(), 'en')).rejects.toThrow(unavailable)
    })

    it.each(['not valid JSON', '{"foo":"bar"}'])('reports malformed diagnosis output (%s)', async (text) => {
      respondWith(text)
      await expect(diagnoseError(makeError(), 'en')).rejects.toThrow(diagnosisUnavailable)
    })

    it('uses the configured default model for a detailed diagnosis', async () => {
      respondWith(JSON.stringify({ summary: 'Error', explanation: 'Something went wrong.', steps: [] }))

      await expect(diagnoseError(makeError(), 'en')).resolves.toMatchObject({ summary: 'Error' })
      expect(mockIpcRequest).toHaveBeenCalledExactlyOnceWith(
        'ai.text.generate',
        expect.objectContaining({
          uniqueModelId: defaultModel.id,
          // Diagnosis must keep working for a signed-out user on the built-in free model.
          utilityTask: true,
          requestOptions: { maxRetries: 0 }
        })
      )
    })

    it('includes context in error info', async () => {
      const mockResult = {
        summary: 'Error',
        category: 'unknown',
        explanation: 'Something went wrong.',
        steps: []
      }
      respondWith(JSON.stringify(mockResult))

      await diagnoseError(makeError({ statusCode: 401 }), 'zh-CN', {
        errorSource: 'chat',
        providerId: 'openai',
        modelId: 'gpt-4'
      })

      const callArgs = requestInput()
      expect(callArgs.prompt).toContain('openai')
      expect(callArgs.prompt).toContain('gpt-4')
      expect(callArgs.prompt).toContain('401')
    })

    it('defaults category to unknown when missing', async () => {
      respondWith(
        JSON.stringify({
          summary: 'Error',
          explanation: 'Something went wrong.',
          steps: []
        })
      )

      const result = await diagnoseError(makeError(), 'en')
      expect(result.category).toBe('unknown')
    })

    it('forwards responseBody and uses its quota signal in the prompt', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'quota', explanation: 'x', steps: [] }))
      const providerJson = '{"error":{"type":"insufficient_quota","code":"billing_hard_limit_reached"}}'

      await diagnoseError(makeError({ statusCode: 429, responseBody: providerJson }), 'en')

      const callArgs = requestInput()
      expect(callArgs.prompt).toContain('billing_hard_limit_reached')
    })

    it('gives payload-too-large errors actionable context', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'payload', explanation: 'x', steps: [] }))

      await diagnoseError(
        makeError({
          statusCode: 413,
          message: '413 Request Entity Too Large',
          responseBody: '<html><body><h1>413 Request Entity Too Large</h1></body></html>'
        }),
        'en'
      )

      const callArgs = requestInput()
      expect(callArgs.system).toContain('request payload is too large')
      expect(callArgs.system).toContain('new topic')
      expect(callArgs.system).toContain('attachments')
      expect(callArgs.system).toContain('summarize')
    })

    it('routes a Chromium DNS failure to network/proxy context', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'network', explanation: 'x', steps: [] }))

      await diagnoseError(makeError({ message: 'net::ERR_NAME_NOT_RESOLVED' }), 'en')

      const callArgs = requestInput()
      expect(callArgs.system).toContain('Network or proxy error')
    })

    it('routes a Chromium connection reset to network/proxy context', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'stream', explanation: 'x', steps: [] }))

      await diagnoseError(makeError({ message: 'net::ERR_CONNECTION_RESET' }), 'en')

      const callArgs = requestInput()
      expect(callArgs.system).toContain('Network or proxy error')
    })

    it('forwards finishReason for safety-blocked responses', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'content', explanation: 'x', steps: [] }))

      await diagnoseError(makeError({ name: 'AI_NoObjectGeneratedError', finishReason: 'SAFETY' }), 'en')

      const callArgs = requestInput()
      expect(callArgs.prompt).toContain('SAFETY')
    })

    it('forwards structured data as serialized JSON', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'auth', explanation: 'x', steps: [] }))

      await diagnoseError(makeError({ data: { error: { code: 'invalid_api_key', message: 'Key revoked' } } }), 'en')

      const callArgs = requestInput()
      expect(callArgs.prompt).toContain('invalid_api_key')
      expect(callArgs.prompt).toContain('Key revoked')
    })

    // The inline card classifies 403 as `permission`; the prompt must not then tell the user
    // their key is invalid. Region and quota keep winning, matching `classifyError`.

    it('falls back to provider and model fields on the error', async () => {
      respondWith(JSON.stringify({ summary: 'x', category: 'auth', explanation: 'x', steps: [] }))

      await diagnoseError(makeError({ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }), 'en')

      const callArgs = requestInput()
      expect(callArgs.prompt).toContain('anthropic')
      expect(callArgs.prompt).toContain('claude-sonnet-4-5')
    })
  })

  it('blocks both diagnosis entry points when data collection is off', async () => {
    await preferenceService.set('app.privacy.data_collection.enabled', false)

    await expect(classifyErrorByAI(makeError(), 'en')).rejects.toThrow(diagnosisUnavailable)
    await expect(diagnoseError(makeError(), 'en')).rejects.toThrow(diagnosisUnavailable)
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('blocks a diagnosis if data collection is turned off during model resolution', async () => {
    vi.mocked(dataApiService.get).mockImplementationOnce(async () => {
      await preferenceService.set('app.privacy.data_collection.enabled', false)
      return defaultModel
    })

    await expect(classifyErrorByAI(makeError(), 'en')).rejects.toThrow(diagnosisUnavailable)
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['not configured', null],
    ['deleted', 'custom-provider::deleted-model']
  ])('does not send when the default model is %s', async (_, modelId) => {
    await preferenceService.set('chat.default_model_id', modelId)

    await expect(classifyErrorByAI(makeError(), 'en')).rejects.toThrow(unavailable)
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it.each(['model', 'provider'])('does not send when the default %s is disabled', async (kind) => {
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (path === `/models/${defaultModel.id}`) return { ...defaultModel, isEnabled: kind !== 'model' }
      if (path === `/providers/${defaultModel.providerId}`) return { isEnabled: kind !== 'provider' }
      return undefined
    })

    await expect(classifyErrorByAI(makeError(), 'en')).rejects.toThrow(unavailable)
    expect(mockIpcRequest).not.toHaveBeenCalled()
  })

  it('surfaces a default-model error when the request fails', async () => {
    mockIpcRequest.mockRejectedValue(new Error('network unavailable'))

    await expect(classifyErrorByAI(makeError(), 'en')).rejects.toThrow(unavailable)
    expect(mockIpcRequest).toHaveBeenCalledExactlyOnceWith(
      'ai.text.generate',
      expect.objectContaining({ uniqueModelId: defaultModel.id, requestOptions: { maxRetries: 0 } })
    )
  })
})
