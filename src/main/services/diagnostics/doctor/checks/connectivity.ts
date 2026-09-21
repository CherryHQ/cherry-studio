import { APICallError } from 'ai'

import { application } from '@application'
import { serializeError } from '@main/ai/utils/serializeError'
import { createUniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { classifyErrorCategory, isErrorCategory } from '@shared/utils/errorCategory'
import { redactUrlParams } from '@shared/utils/redaction'

import { defaultChatModelId } from '../subjectDefaults'
import { defineDoctorCheck, type DoctorContext, type DoctorProbeOutcome } from '../types'

const PROVIDER_SETTINGS_ACTION = [{ kind: 'navigate', target: '/settings/provider' }] as const

function modelTarget(ctx: DoctorContext) {
  return ctx.share('provider:model-check', async () => {
    const { providerId, modelId } = ctx.subject ?? {}
    const uniqueModelId =
      providerId && modelId ? createUniqueModelId(providerId, modelId) : await defaultChatModelId(ctx)
    if (!uniqueModelId) throw new Error('No model is configured for this subject')
    const target = application.get('AiService').prepareModelCheck(UniqueModelIdSchema.parse(uniqueModelId))
    return {
      ...target,
      isCurrent: () =>
        target.isCurrent() &&
        (ctx.subject != null || application.get('PreferenceService').get('chat.default_model_id') === uniqueModelId)
    }
  })
}

function requestFailure<Id extends 'provider-model-list' | 'provider-model-conversation'>(
  error: unknown
): DoctorProbeOutcome<Id> {
  const serialized = serializeError(error)
  const status = typeof serialized.statusCode === 'number' ? serialized.statusCode : undefined
  const category = isErrorCategory(serialized.providerErrorCategory)
    ? serialized.providerErrorCategory
    : classifyErrorCategory({ text: serialized.message ?? '', status })
  return {
    status: 'fail',
    attribution: ['auth', 'permission', 'region', 'model', 'quota'].includes(category) ? 'user-fixable' : 'transient',
    actions: PROVIDER_SETTINGS_ACTION,
    detail: { variant: 'request_failed', params: { category } },
    evidence: [
      { key: 'category', value: category, dataClass: 'public' },
      ...(status !== undefined ? [{ key: 'httpStatus', value: status, dataClass: 'public' as const }] : [])
    ]
  }
}

export const modelEndpoint = defineDoctorCheck({
  id: 'network-model-endpoint',
  async run(ctx) {
    const target = await modelTarget(ctx)
    if (!target.baseUrl) return { status: 'skip', detail: { variant: 'no_base_url' } }
    const diagnosis = await application
      .get('NetworkService')
      .diagnoseEndpoint({ id: 'custom', url: target.baseUrl }, ctx.signal)
    if (diagnosis.http.status !== 'ok') {
      return {
        status: 'fail',
        attribution: 'transient',
        detail: { variant: 'unreachable' },
        actions: PROVIDER_SETTINGS_ACTION
      }
    }
    return {
      status: 'pass',
      evidence: diagnosis.http.data
        ? [{ key: 'httpStatus', value: diagnosis.http.data.status, dataClass: 'public' }]
        : []
    }
  },
  fixes: {}
})

export const modelList = defineDoctorCheck({
  id: 'provider-model-list',
  async run(ctx) {
    const target = await modelTarget(ctx)
    if (!target.supportsModelListing) return { status: 'skip', detail: { variant: 'unsupported' } }
    try {
      const models = await target.listModels(ctx.signal)
      return models.includes(target.modelId)
        ? { status: 'pass' }
        : {
            status: 'warn',
            attribution: 'user-fixable',
            detail: { variant: 'not_listed' },
            actions: PROVIDER_SETTINGS_ACTION
          }
    } catch (error) {
      ctx.signal.throwIfAborted()
      if (APICallError.isInstance(error) && [404, 405, 501].includes(error.statusCode ?? 0)) {
        return { status: 'skip', detail: { variant: 'endpoint_unavailable' } }
      }
      return requestFailure<'provider-model-list'>(error)
    }
  },
  fixes: {}
})

export const modelConversation = defineDoctorCheck({
  id: 'provider-model-conversation',
  async getConfirmation(ctx) {
    const target = await modelTarget(ctx)
    if (target.isExternalCli) return { status: 'skip', detail: { variant: 'external_cli' } }
    if (!target.supportsChat) return { status: 'skip', detail: { variant: 'not_chat_model' } }
    return {
      confirmation: {
        messageKey: 'settings.doctor.checks.provider-model-conversation.confirmation',
        params: { model: target.modelName, modelId: target.modelId, endpoint: redactUrlParams(target.baseUrl) }
      },
      isCurrent: target.isCurrent
    }
  },
  async run(ctx) {
    const target = await modelTarget(ctx)
    try {
      await target.checkConversation(ctx.signal)
      return { status: 'pass' }
    } catch (error) {
      ctx.signal.throwIfAborted()
      return requestFailure<'provider-model-conversation'>(error)
    }
  },
  fixes: {}
})
