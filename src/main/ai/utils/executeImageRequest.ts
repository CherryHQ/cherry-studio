import { application } from '@application'
import { generateImage as aiCoreGenerateImage } from '@cherrystudio/ai-core'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobHandle } from '@main/core/job/types'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import { type Base64String, Base64StringSchema } from '@shared/types/file'

import type { AiImageRequest, AiImageResult, AsInProcess } from '../AiService'
import type { NativeImageTarget } from '../provider/custom/imageTransportRegistry'
import { deleteImageInputEntries } from '../provider/custom/tasks/imageGenerationJobHandler'
import { imageJobConnectionKey } from '../provider/custom/tasks/imageJobConnection'
import type {
  ImageGenerationJobOutput,
  ImageGenerationJobPayload,
  ImageJobInput
} from '../provider/custom/tasks/jobTypes'
import { buildSdkImageOptions, resolveSdkImageConfig } from '../provider/imageSdk'
import type { AppProviderSettingsMap } from '../types'
import { resolveImageRequestSize } from './aiSdkNativeBindings'
import { customFetch } from './customFetch'
import { splitParamValues } from './imageOptions'
import type { prepareImageExecution } from './prepareImageRequest'
import { createModelUsageCaptureContext, createProviderCallHandler } from './usageCapture'

const logger = loggerService.withContext('imageExecution')
type PreparedImageExecution = ReturnType<typeof prepareImageExecution>

/** Execute the prepared scheduling decision, then deliver persisted image files. */
export async function executeImageRequest(
  prepared: PreparedImageExecution,
  source: SourceSnapshot | undefined
): Promise<AiImageResult> {
  const { request, target } = prepared
  if (target.scheduling === 'job') {
    return executeImageJob(
      { ...request, uniqueModelId: prepared.model.id },
      request.requestOptions?.signal,
      source,
      target.protocol,
      target.modelId,
      imageJobConnectionKey(prepared.provider, prepared.model)
    )
  }
  const { result, sdkConfig } = await executeDirectImageRequest(prepared, source)
  const dataUrls: Base64String[] = []
  let filteredCount = 0
  for (const image of result.images ?? []) {
    if (image.base64) {
      dataUrls.push(`data:${image.mediaType || 'image/png'};base64,${image.base64}`)
      continue
    }

    filteredCount += 1
  }

  if (filteredCount > 0) {
    logger.warn('Filtered invalid generated images', {
      uniqueModelId: request.uniqueModelId,
      providerId: sdkConfig.providerId,
      modelId: sdkConfig.modelId,
      filteredCount
    })
  }
  const fileManager = application.get('FileManager')
  const files = await Promise.all(
    dataUrls.map((data) =>
      fileManager.createInternalEntry({ source: 'base64', data, cleanupPolicy: request.cleanupPolicy })
    )
  )

  return { files }
}

/** Probes use the same prepared adapter and runtime, without creating an undeliverable Job or output files. */
export async function probeImageRequest(prepared: PreparedImageExecution): Promise<void> {
  await executeDirectImageRequest(prepared, undefined)
}

async function executeDirectImageRequest(prepared: PreparedImageExecution, source: SourceSnapshot | undefined) {
  const { request, provider, model, target } = prepared
  const signal = request.requestOptions?.signal
  const { sdkConfig, credentialReceipt } = await resolveSdkImageConfig(provider, model, target, request.apiKeyOverride)
  const sdkRequest =
    target.kind === 'sdk'
      ? {
          ...request,
          inputImages: request.inputImages
            ? await Promise.all(request.inputImages.map((image) => downloadSdkImageInput(image, signal)))
            : undefined,
          mask: request.mask ? await downloadSdkImageInput(request.mask, signal) : undefined
        }
      : request
  const imageParams = {
    ...buildSdkImageOptions(sdkRequest, sdkConfig, signal),
    experimental_download: async (downloads) => {
      return Promise.all(
        downloads.map(async ({ url }) => {
          const downloaded = await downloadImageAsBase64(url.toString(), { signal, fetch: customFetch })
          if (!downloaded) return null
          return {
            data: Buffer.from(downloaded.data, 'base64'),
            mediaType: downloaded.media_type
          }
        })
      )
    }
  }

  const imageUsageContext = createModelUsageCaptureContext({
    provider,
    model,
    sdkModelId: sdkConfig.modelId,
    credentialReceipt,
    source,
    messageRef: null
  })
  try {
    const result = await aiCoreGenerateImage<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
      ...imageParams,
      onProviderCall: createProviderCallHandler(imageUsageContext)
    })
    if (signal?.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    return { result, sdkConfig }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    throw error
  }
}

async function downloadSdkImageInput(image: string, signal: AbortSignal | undefined): Promise<string> {
  if (image.startsWith('data:')) return image
  const downloaded = await downloadImageAsBase64(image, { signal, fetch: customFetch })
  if (!downloaded) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
  return `data:${downloaded.media_type};base64,${downloaded.data}`
}

async function executeImageJob(
  request: AsInProcess<AiImageRequest>,
  signal: AbortSignal | undefined,
  source: SourceSnapshot | undefined,
  target: NativeImageTarget,
  modelId: string,
  connectionKey: string
): Promise<AiImageResult> {
  const { structured, vendorBag: providerParams } = splitParamValues(request.paramValues)
  const uniqueModelId = request.uniqueModelId
  if (!uniqueModelId) throw new Error('executeImageJob requires a uniqueModelId')

  const fileManager = application.get('FileManager')
  const jobManager = application.get('JobManager')

  const createdEntryIds: string[] = []
  const persistInputImage = async (value: string): Promise<ImageJobInput> => {
    if (!value.startsWith('data:')) return { type: 'url', url: value }
    const entry = await fileManager.createInternalEntry({
      source: 'base64',
      data: Base64StringSchema.parse(value),
      cleanupPolicy: 'delete_when_unreferenced'
    })
    createdEntryIds.push(entry.id)
    return { type: 'file', fileId: entry.id }
  }

  let handle: JobHandle
  try {
    // allSettled (not all) so every create resolves before we decide: a partial
    // failure still leaves `createdEntryIds` complete for the catch to clean up.
    if (signal?.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    const settled = await Promise.allSettled((request.inputImages ?? []).map(persistInputImage))
    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejected) throw rejected.reason
    const inputImages = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const mask = request.mask ? await persistInputImage(request.mask) : undefined
    if (signal?.aborted) throw new DOMException('Image generation aborted', 'AbortError')
    const requestSize = resolveImageRequestSize(structured.size)

    const payload: ImageGenerationJobPayload = {
      uniqueModelId,
      modelId,
      connectionKey,
      prompt: request.prompt,
      n: structured.n ?? 1,
      ...(requestSize !== undefined && { size: requestSize }),
      ...(structured.aspectRatio && { aspectRatio: structured.aspectRatio }),
      seed: structured.seed,
      inputImages,
      mask,
      target,
      ...(source && { source }),
      providerParams,
      cleanupPolicy: request.cleanupPolicy
    }
    // Publish the Job and its input ownership atomically, before GC can reclaim the inputs.
    handle = application.get('DbService').withWriteTx((tx) => {
      const jobHandle = jobManager.enqueueTx(tx, 'image-generation.generate', payload)
      jobService.addFileRefsTx(tx, [
        ...inputImages.flatMap((image) =>
          image.type === 'file'
            ? [
                {
                  fileEntryId: image.fileId,
                  sourceId: jobHandle.id,
                  role: 'input' as const
                }
              ]
            : []
        ),
        ...(mask?.type === 'file' ? [{ fileEntryId: mask.fileId, sourceId: jobHandle.id, role: 'mask' as const }] : [])
      ])
      return jobHandle
    })
  } catch (error) {
    // Setup failed before the job owns the payload — clean up what we created.
    await deleteImageInputEntries(createdEntryIds)
    throw error
  }

  // Reuse the existing IPC AbortController (ai.image.abort): when it fires,
  // cancel the job (which aborts the handler + remote task).
  const onAbort = () => void jobManager.cancel(handle.id, 'aborted by user').catch(() => {})
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  let snapshot: JobSnapshot
  try {
    snapshot = await handle.finished
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }

  if (snapshot.status === 'completed') {
    const output = snapshot.output as ImageGenerationJobOutput | null
    return { files: output?.files ?? [] }
  }
  if (snapshot.status === 'cancelled') {
    throw new DOMException('Image generation aborted', 'AbortError')
  }
  // Empty vendor error bodies still need a message the renderer can display.
  throw new Error(snapshot.error?.message || 'Image generation failed')
}
