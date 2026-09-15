import { APICallError } from 'ai'

import { application } from '@application'
import type { AiService } from '@main/ai/AiService'
import { serializeError } from '@main/ai/utils/serializeError'
import type { ConnectivityProbeOutcome, ModelConnectivityReport } from '@shared/types/doctorConnectivity'
import { classifyErrorCategory, isErrorCategory } from '@shared/utils/errorCategory'

import { runDoctorChecks } from './engine'

export async function checkModelConnectivity(
  target: ReturnType<AiService['prepareModelCheck']>,
  signal: AbortSignal
): Promise<ModelConnectivityReport> {
  type Results = Omit<ModelConnectivityReport, 'uniqueModelId'>
  const checks: Record<keyof Results, (signal: AbortSignal) => Promise<ConnectivityProbeOutcome>> = {
    baseUrl: async (signal) => {
      if (!target.baseUrl) return { status: 'skip', reason: 'no_base_url' }
      const diagnosis = await application
        .get('NetworkService')
        .diagnoseEndpoint({ id: 'custom', url: target.baseUrl }, signal)
      if (diagnosis.http.status !== 'ok') return { status: 'fail', reason: 'network' }
      return { status: 'pass', httpStatus: diagnosis.http.data?.status }
    },
    modelList: async (signal) => {
      if (!target.supportsModelListing) return { status: 'skip', reason: 'model_list_unsupported' }
      let models: string[]
      try {
        models = await target.listModels(signal)
      } catch (error) {
        // An unavailable listing endpoint says nothing about the provider's chat capability.
        if (APICallError.isInstance(error) && [404, 405, 501].includes(error.statusCode ?? 0)) {
          return { status: 'skip', reason: 'model_list_endpoint_unavailable' }
        }
        throw error
      }
      return models.includes(target.modelId) ? { status: 'pass' } : { status: 'warn', reason: 'model_not_listed' }
    },
    conversation: async (signal) => {
      if (!target.supportsChat) return { status: 'skip', reason: 'not_chat_model' }
      await target.checkConversation(signal)
      return { status: 'pass' }
    }
  }
  const results = await runDoctorChecks({
    signal,
    laneLimits: { connectivity: 1 },
    checks: Object.entries(checks).map(([id, run]) => ({
      id,
      requires: [],
      lane: 'connectivity',
      timeoutMs: 15_000,
      async run(signal): Promise<ConnectivityProbeOutcome> {
        signal.throwIfAborted()
        try {
          return await run(signal)
        } catch (error) {
          signal.throwIfAborted()
          const serialized = serializeError(error)
          const httpStatus = typeof serialized.statusCode === 'number' ? serialized.statusCode : undefined
          return {
            status: 'fail',
            reason: isErrorCategory(serialized.providerErrorCategory)
              ? serialized.providerErrorCategory
              : classifyErrorCategory({ text: serialized.message ?? '', status: httpStatus }),
            ...(httpStatus !== undefined && { httpStatus })
          }
        }
      }
    }))
  })
  signal.throwIfAborted()
  const report = Object.fromEntries(results.map(({ id, ...result }) => [id, result])) as Results
  return { uniqueModelId: target.uniqueModelId, ...report }
}
