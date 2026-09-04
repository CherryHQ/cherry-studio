import { application } from '@application'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { getAppEdition } from '@main/utils/appEdition'
import { parseUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { isLoginBasedProvider } from '@shared/utils/provider'

import { defineDoctorCheck } from '../types'

const PROVIDER_SETTINGS_ACTION = [{ kind: 'navigate', target: '/settings/provider' }] as const

export const defaultModel = defineDoctorCheck({
  id: 'provider-default-model',
  async run() {
    const defaultModelId = application.get('PreferenceService').get('chat.default_model_id')
    if (!defaultModelId) {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'not_configured' },
        actions: PROVIDER_SETTINGS_ACTION,
        devMessage: 'No default model is configured'
      }
    }

    const parsed = UniqueModelIdSchema.safeParse(defaultModelId)
    if (!parsed.success) {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'invalid_id' },
        actions: PROVIDER_SETTINGS_ACTION,
        devMessage: 'The default model id is malformed',
        evidence: [{ key: 'defaultModelId', value: defaultModelId, dataClass: 'public' }]
      }
    }

    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    let provider
    try {
      provider = providerService.getByProviderId(providerId)
    } catch {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'provider_unavailable' },
        actions: PROVIDER_SETTINGS_ACTION,
        devMessage: 'The default model provider is unavailable',
        evidence: [{ key: 'providerId', value: providerId, dataClass: 'public' }]
      }
    }

    if (!provider.isEnabled) {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'provider_disabled' },
        actions: PROVIDER_SETTINGS_ACTION,
        devMessage: 'The default model provider is disabled',
        evidence: [{ key: 'providerId', value: providerId, dataClass: 'public' }]
      }
    }

    try {
      modelService.getByKey(providerId, modelId)
    } catch {
      return {
        status: 'fail',
        attribution: 'user-fixable',
        detail: { variant: 'model_unavailable' },
        actions: PROVIDER_SETTINGS_ACTION,
        devMessage: 'The configured default model is unavailable',
        evidence: [
          { key: 'providerId', value: providerId, dataClass: 'public' },
          { key: 'modelId', value: modelId, dataClass: 'public' }
        ]
      }
    }

    return { status: 'pass' }
  },
  fixes: {}
})

export const defaultProviderApiKey = defineDoctorCheck({
  id: 'provider-api-key-present',
  async run() {
    const defaultModelId = application.get('PreferenceService').get('chat.default_model_id')
    const parsed = UniqueModelIdSchema.safeParse(defaultModelId)
    if (!parsed.success) return { status: 'pass' }

    const { providerId } = parseUniqueModelId(parsed.data)
    let provider
    try {
      provider = providerService.getByProviderId(providerId)
    } catch {
      return { status: 'pass' }
    }

    if (isLoginBasedProvider(provider) || provider.authOptional || provider.apiKeys.some((key) => key.isEnabled)) {
      return { status: 'pass' }
    }

    return {
      status: 'fail',
      attribution: 'user-fixable',
      detail: { variant: 'missing' },
      actions: PROVIDER_SETTINGS_ACTION,
      devMessage: 'The default model provider has no enabled API key',
      evidence: [{ key: 'providerId', value: providerId, dataClass: 'public' }]
    }
  },
  fixes: {}
})

export const cherryAccount = defineDoctorCheck({
  id: 'provider-cherry-account',
  async run() {
    if (getAppEdition() !== 'cn') return { status: 'pass' }
    const status = await application.get('CherryCloudService').getStatus()
    if (status.phase !== 'signed-out') return { status: 'pass' }

    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'signed_out' },
      actions: [{ kind: 'open_cherry_account' }],
      devMessage: 'There is no valid Cherry account session'
    }
  },
  fixes: {}
})
