import { application } from '@application'
import { loggerService } from '@logger'
import type { EnqueueOptions } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileHandle } from '@shared/data/types/file'
import { ListAvailableFileProcessorsResultSchema } from '@shared/data/types/fileProcessing'
import { net } from 'electron'

import { getFileProcessorConfigById, resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { ocrImageToText } from './ocrImageToText'
import { processorRegistry } from './processors/registry'
import { backgroundJobHandler, localBackgroundJobHandler } from './tasks/backgroundJobHandler'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'
import { remotePollJobHandler } from './tasks/remotePollJobHandler'
import type { FileProcessingJobPayload } from './tasks/shared'
import type { ListAvailableFileProcessorsResult, StartFileProcessingJobInput } from './types'
import { getRequiredApiHost, getRequiredCapability } from './utils/provider'

const logger = loggerService.withContext('FileProcessingService')

/**
 * Long enough for a LAN host, short enough that the dropdown gating it does not
 * feel stuck. Matches OpenClawService's gateway health probe.
 */
const CONNECTIVITY_PROBE_TIMEOUT_MS = 3_000

@Injectable('FileProcessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
export class FileProcessingService extends BaseService {
  protected onInit(): void {
    // Register handlers in onInit (NOT onReady) so JobManager.onAllReady's
    // startup recovery sweep sees them when re-dispatching non-terminal jobs.
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('file-processing.background', backgroundJobHandler)
    jobManager.registerHandler('file-processing.background-local', localBackgroundJobHandler)
    jobManager.registerHandler('file-processing.remote-poll', remotePollJobHandler)
    logger.info('File processing service initialized')
  }

  /**
   * Enqueue a file-processing job.
   *
   * Each call creates a fresh processing job. Neither the `file` handle (a path
   * or entry reference) nor `context.dataId` (a provider-specific task id, e.g.
   * MinerU's data_id) is a content-version identity, so do not use either as an
   * idempotency key. If we add reuse later, scope it to a contentHash plus
   * processor/config/version.
   *
   * The handler.mode field on the capability handler determines the JobRegistry
   * type to enqueue under (background vs remote-poll), and for background the
   * processor's `runtime` picks the local or remote half. Both are synchronous
   * lookups — no `await prepare()` is needed at enqueue time.
   */
  async startJob(
    input: StartFileProcessingJobInput,
    options: Pick<EnqueueOptions, 'parentId'> = {}
  ): Promise<JobSnapshot> {
    const { feature, file, output, context, processorId } = input
    // `document_to_markdown` always produces a markdown/zip artifact that needs a
    // path output target. Reject the illegal state here, before enqueueing (and
    // before any remote API call), instead of failing late in artifact persistence.
    if (feature === 'document_to_markdown' && output?.kind !== 'path') {
      throw new Error("File processing feature 'document_to_markdown' requires a path output target")
    }
    const config = resolveProcessorConfigByFeature(feature, processorId)
    const handler = getCapabilityHandler(config.id, feature)
    const fileInfo = await resolveFileProcessingFileInfo(file)
    assertFileTypeSupported(fileInfo, feature, config)

    const payload: FileProcessingJobPayload = {
      feature,
      file,
      processorId: config.id,
      ...(output ? { output } : {}),
      ...(context ? { context } : {})
    }

    const type =
      handler.mode === 'remote-poll'
        ? 'file-processing.remote-poll'
        : processorRegistry[config.id].runtime === 'local'
          ? 'file-processing.background-local'
          : 'file-processing.background'
    const jobManager = application.get('JobManager')
    const handle = jobManager.enqueue(type, payload, options.parentId ? { parentId: options.parentId } : {})

    logger.debug('Enqueued file processing job', {
      jobId: handle.id,
      type,
      feature,
      processorId: config.id,
      file,
      output
    })

    return handle.snapshot
  }

  /**
   * OCR an image into plain text using the user's configured `image_to_text`
   * processor — the synchronous, content-version-cached path used by the AI chat
   * attachment flow (`attachmentRouting` / `read_file`). Keeps OCR processor /
   * handler internals owned by this domain instead of being deep-imported from
   * `ai/`. Throws on failure / no configured processor; callers turn that into a
   * model-facing note.
   */
  ocrImage(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return ocrImageToText(file, signal)
  }

  /**
   * Processors this machine could run — the settings pages list exactly these.
   *
   * Filters on platform support only. A processor whose local model is not
   * downloaded yet still belongs in the list: hiding it strands the user, since
   * its settings entry is where the download button lives.
   */
  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const processorIds = Object.entries(processorRegistry)
      .filter(([, processor]) => processor.isSupported())
      .map(([processorId]) => processorId as FileProcessorId)
    return ListAvailableFileProcessorsResultSchema.parse({ processorIds })
  }

  /**
   * Is a self-hosted processor's server actually up?
   *
   * For a processor the user runs themselves there is nothing in the config that
   * answers this — Open MinerU needs no API key and its preset ships a working
   * default host, so a user who has done nothing looks identical to one running
   * a real deployment. Only the host can tell us apart.
   *
   * Probes `/health`, the endpoint both `mineru-api` and `mineru-router` expose,
   * and treats **404 as the one negative answer**: something is listening but it
   * has no `/health`, so it is not MinerU (port 8000 is a busy neighbourhood).
   * Every other status means the server is alive and we let it through — 503 is
   * how MinerU reports a full request queue, 401/403 come from a reverse proxy in
   * front of it, and greying out a working deployment is far worse than letting a
   * broken one through, which merely fails the way it already does today.
   *
   * Deliberately no `sanitizeRemoteUrl`: the host being probed is the same one
   * `executeTask` posts the user's document to with a bare `net.fetch`, and this
   * sends an unauthenticated GET whose body we never read. A probe stricter than
   * the execution path would report "unreachable" for hosts that actually work.
   */
  async checkOpenMineruConnectivity(): Promise<boolean> {
    const processorId = 'open-mineru'
    const feature = 'document_to_markdown'
    const config = getFileProcessorConfigById(processorId)
    const capability = getRequiredCapability(config, feature, processorId)

    let apiHost: string
    try {
      apiHost = getRequiredApiHost(capability)
    } catch {
      // No host to reach — the user cleared it, which is its own kind of "down".
      return false
    }

    try {
      const response = await net.fetch(`${apiHost}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(CONNECTIVITY_PROBE_TIMEOUT_MS)
      })
      return response.status !== 404
    } catch (error) {
      logger.debug('File processor connectivity probe failed', { processorId, apiHost, error })
      return false
    }
  }
}
