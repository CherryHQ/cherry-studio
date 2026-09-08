import { application } from '@application'
import { generateImage as aiCoreGenerateImage } from '@cherrystudio/ai-core'
import type { SourceSnapshot } from '@data/services/AiUsageRecordService'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import type { JobHandle } from '@main/core/job/types'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { Base64String, CreateInternalEntryIpcParams, UrlString } from '@shared/types/file'

import type { AiImageRequest, AiImageResult, AsInProcess } from '../AiService'
import type { NativeImageTarget } from '../provider/custom/imageTransportRegistry'
import { deleteImageInputEntries } from '../provider/custom/tasks/imageGenerationJobHandler'
import type { ImageGenerationJobOutput, ImageGenerationJobPayload } from '../provider/custom/tasks/jobTypes'
import { buildSdkImageOptions, resolveSdkImageConfig } from '../provider/imageSdk'
import type { AppProviderSettingsMap } from '../types'
import { resolveImageRequestSize } from './aiSdkNativeBindings'
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
      target.protocol
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
  const imageParams = {
    ...buildSdkImageOptions(request, sdkConfig, signal),
    experimental_download: async (downloads) => {
      return Promise.all(
        downloads.map(async ({ url }) => {
          if (signal?.aborted) return null
          const downloaded = await downloadImageAsBase64(url.toString())
          if (signal?.aborted) return null
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
  const result = await aiCoreGenerateImage<AppProviderSettingsMap>(sdkConfig.providerId, sdkConfig.providerSettings, {
    ...imageParams,
    onProviderCall: createProviderCallHandler(imageUsageContext)
  })

  return { result, sdkConfig }
}

/** Scratch copies belong to the Job, never to the caller's output retention policy. */
export function imageInputEntryParams(value: string): CreateInternalEntryIpcParams {
  return value.startsWith('data:')
    ? { source: 'base64', data: value as Base64String, cleanupPolicy: 'delete_when_unreferenced' }
    : { source: 'url', url: value as UrlString, cleanupPolicy: 'delete_when_unreferenced' }
}

async function executeImageJob(
  request: AsInProcess<AiImageRequest>,
  signal: AbortSignal | undefined,
  source: SourceSnapshot | undefined,
  target: NativeImageTarget
): Promise<AiImageResult> {
  const { structured, vendorBag: providerParams } = splitParamValues(request.paramValues)
  const uniqueModelId = request.uniqueModelId
  if (!uniqueModelId) throw new Error('executeImageJob requires a uniqueModelId')

  const fileManager = application.get('FileManager')
  const jobManager = application.get('JobManager')

  const createdEntryIds: string[] = []
  const persistInputImage = async (value: string): Promise<string> => {
    const entry = await fileManager.createInternalEntry(imageInputEntryParams(value))
    createdEntryIds.push(entry.id)
    return entry.id
  }

  let handle: JobHandle
  try {
    // allSettled (not all) so every create resolves before we decide: a partial
    // failure still leaves `createdEntryIds` complete for the catch to clean up.
    const settled = await Promise.allSettled((request.inputImages ?? []).map(persistInputImage))
    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejected) throw rejected.reason
    const inputFileIds = settled.length ? settled.map((r) => (r as PromiseFulfilledResult<string>).value) : undefined
    const maskFileId = request.mask ? await persistInputImage(request.mask) : undefined
    const requestSize = resolveImageRequestSize(structured.size)

    const payload: ImageGenerationJobPayload = {
      uniqueModelId,
      prompt: request.prompt,
      n: structured.n ?? 1,
      ...(requestSize !== undefined && { size: requestSize }),
      ...(structured.aspectRatio && { aspectRatio: structured.aspectRatio }),
      seed: structured.seed,
      ...(inputFileIds && { inputFileIds }),
      ...(maskFileId && { maskFileId }),
      target,
      ...(source && { source }),
      providerParams,
      cleanupPolicy: request.cleanupPolicy
    }
    // Publish the Job and its input ownership atomically, before GC can reclaim the inputs.
    handle = application.get('DbService').withWriteTx((tx) => {
      const jobHandle = jobManager.enqueueTx(tx, 'image-generation.generate', payload)
      jobService.addFileRefsTx(tx, [
        ...(inputFileIds ?? []).map((fileEntryId) => ({
          fileEntryId,
          sourceId: jobHandle.id,
          role: 'input' as const
        })),
        ...(maskFileId ? [{ fileEntryId: maskFileId, sourceId: jobHandle.id, role: 'mask' as const }] : [])
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
