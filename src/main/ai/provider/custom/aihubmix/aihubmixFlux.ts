import {
  combineHeaders,
  createJsonResponseHandler,
  type FetchFunction,
  getFromApi,
  postJsonToApi
} from '@ai-sdk/provider-utils'
import type { VendorBag } from '@main/ai/utils/imageOptions'
import * as z from 'zod'

import {
  AIHUBMIX_FLUX_POLL_POLICY,
  completedImageTransportTask,
  type ImageGenerationSubmitInput,
  type ImageTransportTaskContext,
  type ImageTransportTaskState,
  submittedImageTransportSubmission,
  type TaskImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

/**
 * AiHubMix BFL async FLUX transport.
 *
 * Backs `flux-2-flex` / `flux-2-pro` / `flux-kontext-max` — three BFL
 * models that aihubmix exposes as task-based async endpoints (the
 * remaining FLUX variants — `FLUX-1.1-pro`, `FLUX.1-Kontext-pro` — are
 * synchronous and stay on the OpenAI-compat default branch).
 *
 * Wire shape (per https://docs.aihubmix.com/cn/api/Image-Gen):
 *   submit : POST `${apiRoot}/v1/models/bfl/<modelId>/predictions`
 *            body  `{ input: { prompt, aspect_ratio?, safety_tolerance?,
 *                              input_image?, seed? } }`
 *            resp  `{ output: [{ taskId, polling_url }] }`
 *   poll   : GET  `${apiRoot}/v1/tasks/<taskId>`
 *            resp  `{ status: 'Pending'|'Ready'|'Error'|…,
 *                     result: { sample: 'https://...' } }`
 *
 * Field sourcing — `aspectRatio` / `seed` / `files` arrive on the typed submit input;
 * `safetyTolerance` is the one vendor knob, and it is a catalog key so
 * `imageParamsSchema` has already coerced it to an int.
 */
export interface AihubmixFluxTransportSettings {
  apiRoot: string
  apiKey: string
  headers?: Record<string, string | undefined>
  fetch?: FetchFunction
}

/** The one vendor knob BFL takes beyond the native params. */
export type AihubmixFluxBag = Pick<VendorBag, 'safetyTolerance'>

const aihubmixFluxSubmitSchema = z
  .object({ output: z.array(z.object({ taskId: z.string().min(1) }).passthrough()).min(1) })
  .passthrough()
const aihubmixFluxQuerySchema = z
  .object({
    status: z.enum(['Pending', 'Ready', 'Error', 'Request Moderated', 'Content Moderated', 'Task not found']),
    result: z
      .object({ sample: z.string().min(1).optional(), samples: z.array(z.string().min(1)).min(1).optional() })
      .passthrough()
      .optional(),
    detail: z.string().optional()
  })
  .passthrough()

class AihubmixFluxTransport implements TaskImageGenerationTransport<AihubmixFluxBag> {
  private readonly settings: AihubmixFluxTransportSettings

  readonly task: TaskImageGenerationTransport<AihubmixFluxBag>['task'] = {
    kind: 'supported' as const,
    pollPolicy: AIHUBMIX_FLUX_POLL_POLICY,
    query: (taskId: string, context: Parameters<AihubmixFluxTransport['query']>[1]) => this.query(taskId, context),
    cancel: { kind: 'unsupported' as const }
  }

  constructor(settings: AihubmixFluxTransportSettings) {
    this.settings = settings
  }

  supportsInput() {
    return { files: true, mask: false }
  }

  async submit(input: ImageGenerationSubmitInput<AihubmixFluxBag>) {
    const inputBody: Record<string, unknown> = {}
    if (input.prompt) inputBody.prompt = input.prompt

    // One canonical read each. `aspectRatio` is already normalized to `X:Y` by the
    // native binding's `map`, `seed` is the native channel, and `safetyTolerance` is an
    // `optInt` catalog key the IPC boundary already coerced. The previous four-arm
    // probe chain (`aspect_ratio ?? aspectRatio`, three `seed` arms, `safetyTolerance ??
    // safety_tolerance`) laundered all three through the bag; only the caller-stamped
    // `aspect_ratio` could ever arrive, and only because the caller stamped it.
    if (input.aspectRatio) inputBody.aspect_ratio = input.aspectRatio
    if (input.seed !== undefined) inputBody.seed = input.seed
    if (input.providerParams.safetyTolerance !== undefined) {
      inputBody.safety_tolerance = input.providerParams.safetyTolerance
    }

    const firstFile = input.files?.[0]
    if (firstFile) inputBody.input_image = fileToDataUrl(firstFile)

    const url = `${this.settings.apiRoot}/v1/models/bfl/${input.modelId}/predictions`
    const response = await postJsonToApi({
      url,
      headers: combineHeaders(
        { Authorization: `Bearer ${this.settings.apiKey}` },
        this.settings.headers,
        input.headers
      ),
      body: { input: inputBody },
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(aihubmixFluxSubmitSchema)
    })
    return submittedImageTransportSubmission(response.value.output[0].taskId, 'AiHubMix FLUX')
  }

  private async query(
    taskId: string,
    context: ImageTransportTaskContext<AihubmixFluxBag, AbortSignal>
  ): Promise<ImageTransportTaskState> {
    const url = `${this.settings.apiRoot}/v1/tasks/${encodeURIComponent(taskId)}`
    const response = await getFromApi({
      url,
      headers: combineHeaders(
        { Authorization: `Bearer ${this.settings.apiKey}` },
        this.settings.headers,
        context.headers
      ),
      abortSignal: context.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(aihubmixFluxQuerySchema)
    })
    if (response.value.status === 'Ready') {
      const urls = response.value.result?.sample
        ? [response.value.result.sample]
        : (response.value.result?.samples ?? [])
      return completedImageTransportTask(urls, 'AiHubMix FLUX task')
    }
    if (response.value.status !== 'Pending') {
      return {
        kind: 'failed',
        message: response.value.detail || response.value.status
      }
    }
    return { kind: 'pending' }
  }
}

export function createAihubmixFluxTransport(settings: AihubmixFluxTransportSettings): AihubmixFluxTransport {
  return new AihubmixFluxTransport(settings)
}

export type { AihubmixFluxTransport }
