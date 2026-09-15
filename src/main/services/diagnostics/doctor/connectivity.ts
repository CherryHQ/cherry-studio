import { application } from '@application'
import type { AiService } from '@main/ai/AiService'
import type {
  ConnectivityProbeOutcome,
  ConnectivityProbeResult,
  ModelConnectivityReport
} from '@shared/types/doctorConnectivity'

const PROBE_TIMEOUT_MS = 15_000

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined
  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

async function probe(
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<ConnectivityProbeOutcome>
): Promise<ConnectivityProbeResult> {
  signal.throwIfAborted()
  const started = performance.now()
  const deadline = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, deadline])
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(combined.reason)
    combined.addEventListener('abort', onAbort, { once: true })
  })
  try {
    const result = await Promise.race([operation(combined), aborted])
    combined.throwIfAborted()
    return { ...result, durationMs: performance.now() - started }
  } catch (error) {
    signal.throwIfAborted()
    const status = httpStatus(error)
    return {
      status: 'fail',
      reason: deadline.aborted ? 'timeout' : status === 401 || status === 403 ? 'authentication' : 'request_failed',
      ...(status !== undefined && { httpStatus: status }),
      durationMs: performance.now() - started
    }
  } finally {
    combined.removeEventListener('abort', onAbort)
  }
}

export async function checkModelConnectivity(
  target: ReturnType<AiService['prepareModelCheck']>,
  signal: AbortSignal
): Promise<ModelConnectivityReport> {
  const baseUrl = await probe(signal, async (probeSignal) => {
    if (!target.baseUrl) return { status: 'skip', reason: 'no_base_url' }
    const diagnosis = await application
      .get('NetworkService')
      .diagnoseEndpoint({ id: 'custom', url: target.baseUrl }, probeSignal)
    if (diagnosis.http.status !== 'ok') return { status: 'fail', reason: 'network' }
    return { status: 'pass', httpStatus: diagnosis.http.data?.status }
  })
  const modelList = await probe(signal, async (probeSignal) => {
    if (!target.supportsModelListing) return { status: 'skip', reason: 'model_list_unsupported' }
    let models: string[]
    try {
      models = await target.listModels(probeSignal)
    } catch (error) {
      // This describes the configured list endpoint, not the provider's chat capability.
      if ([404, 405, 501].includes(httpStatus(error) ?? 0))
        return { status: 'skip', reason: 'model_list_endpoint_unavailable' }
      throw error
    }
    return models.includes(target.modelId) ? { status: 'pass' } : { status: 'warn', reason: 'model_not_listed' }
  })
  const conversation = await probe(signal, async (probeSignal) => {
    if (!target.supportsChat) {
      return { status: 'skip', reason: 'not_chat_model' }
    }
    await target.checkConversation(probeSignal)
    return { status: 'pass' }
  })
  return { uniqueModelId: target.uniqueModelId, baseUrl, modelList, conversation }
}
