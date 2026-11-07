import PQueue from 'p-queue'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { fileEntryService } from '@main/data/services/FileEntryService'
import { messageService } from '@main/data/services/MessageService'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { IllustrationData, IllustrationTarget } from '@shared/data/types/illustration'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ImageGenerationMode } from '@shared/data/types/model'

import type { IllustrationInput } from './messages/illustrationInputs'
import { extractParamValues, resolveConfiguredPaintingModel } from './tools/painting'
import { parseIllustrationIntent } from './utils/illustrationIntent'

const logger = loggerService.withContext('IllustrationService')
interface IllustrationJob {
  target: IllustrationTarget
  data: IllustrationData
  persisted: boolean
  controller?: AbortController
  detach?: () => void
  fileHolds?: Disposable[]
}

@Injectable('IllustrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService', 'FileManager', 'IpcApiService', 'RuntimeActivityService'])
export class IllustrationService extends BaseService {
  private readonly jobs = new Map<string, IllustrationJob>()
  private readonly queue = new PQueue({ concurrency: 2 })

  start(target: IllustrationTarget, signal: AbortSignal): IllustrationData {
    const data: IllustrationData = { id: target.id, revision: 0, status: 'prompting', prompt: '' }
    const job: IllustrationJob = { target, data, persisted: false }
    const abort = () => this.cancel(target)
    signal.addEventListener('abort', abort, { once: true })
    job.detach = () => signal.removeEventListener('abort', abort)
    this.jobs.set(target.id, job)
    if (signal.aborted) this.cancel(target)
    return job.data
  }

  complete(
    target: IllustrationTarget,
    prompt: string,
    valid: boolean,
    inputs: readonly IllustrationInput[] = []
  ): IllustrationData {
    const job = this.findJob(target)
    if (!job) return { id: target.id, revision: 1, status: 'error', prompt: '', error: 'incomplete' }
    if (job.data.status !== 'prompting') return job.data
    const intent = valid ? parseIllustrationIntent(prompt) : null
    job.data = { ...job.data, prompt: intent?.prompt ?? prompt }
    if (!valid) this.update(job, { status: 'error', error: 'incomplete' })
    else if (!intent || intent.references.some((reference) => !inputs.some((input) => input.reference === reference))) {
      this.update(job, { status: 'error', error: 'invalid_references' })
    } else {
      job.data.inputFiles = intent.references.map((reference) => {
        const { id, name } = inputs.find((input) => input.reference === reference)!
        return { id, name }
      })
      this.retainFiles(job, job.data.inputFiles)
      this.generate(job)
    }
    return job.data
  }

  get(target: IllustrationTarget): IllustrationData | null {
    const live = this.findJob(target)
    if (live) return live.data
    const part = this.readParts(target)?.find((part) => part.type === 'data-illustration' && part.data.id === target.id)
    if (part?.type !== 'data-illustration') return null
    if (part.data.status === 'prompting' || part.data.status === 'generating') {
      const data: IllustrationData = {
        ...part.data,
        revision: part.data.revision + 1,
        status: 'error',
        error: 'interrupted'
      }
      this.patch(target, data)
      return data
    }
    return part.data
  }

  retry(target: IllustrationTarget): IllustrationData | null {
    const data = this.get(target)
    if (
      !data ||
      !data.prompt ||
      data.error === 'incomplete' ||
      data.error === 'invalid_references' ||
      !['error', 'cancelled'].includes(data.status)
    )
      return data
    if (application.get('PreferenceService').get('chat.illustration.mode') === 'off') return data
    const job = this.findJob(target) ?? { target, data, persisted: true }
    this.jobs.set(target.id, job)
    this.generate(job)
    return job.data
  }

  cancel(target: IllustrationTarget): void {
    const job = this.findJob(target)
    if (!job || !['prompting', 'generating'].includes(job.data.status)) return
    job.controller?.abort()
    this.update(job, { status: 'cancelled', error: undefined })
  }

  /** Keeps the terminal message write from overwriting newer background image results. */
  merge(messageId: string, parts: CherryMessagePart[]): CherryMessagePart[] {
    return parts.map((part) => {
      if (part.type !== 'data-illustration') return part
      const job = this.jobs.get(part.data.id)
      if (!job || job.target.messageId !== messageId) return part
      if (job.data.status === 'prompting') this.update(job, { status: 'error', error: 'incomplete' })
      return { ...part, data: job.data }
    })
  }

  /** Completes the synchronous merge/write handoff so later results patch the saved message. */
  didPersist(messageId: string): void {
    for (const job of this.jobs.values()) {
      if (job.target.messageId !== messageId) continue
      job.persisted = true
      job.fileHolds?.forEach((hold) => hold.dispose())
      job.fileHolds = undefined
      if (!['prompting', 'generating'].includes(job.data.status)) {
        job.detach?.()
        this.jobs.delete(job.target.id)
      }
    }
  }

  protected onStop(): void {
    for (const job of this.jobs.values()) {
      this.cancel(job.target)
      job.detach?.()
      job.fileHolds?.forEach((hold) => hold.dispose())
    }
    this.jobs.clear()
  }

  protected onDestroy(): void {
    this.onStop()
  }

  private findJob(target: IllustrationTarget): IllustrationJob | undefined {
    const job = this.jobs.get(target.id)
    return job?.target.topicId === target.topicId && job.target.messageId === target.messageId ? job : undefined
  }

  private retainFiles(job: IllustrationJob, files: readonly { id: string }[]): void {
    job.fileHolds ??= []
    for (const { id } of files) {
      const entry = fileEntryService.findById(id)
      if (entry?.origin === 'internal' && entry.cleanupPolicy === 'delete_when_unreferenced') {
        job.fileHolds.push(application.get('FileManager').retainTemporaryEntry(id))
      }
    }
  }

  private generate(job: IllustrationJob): void {
    const controller = new AbortController()
    job.controller = controller
    this.update(job, { status: 'generating', error: undefined, files: undefined })
    void this.queue
      .add(
        async () => {
          const activity = application.get('RuntimeActivityService').begin(`ai:illustration:${job.target.id}`)
          const timer = setTimeout(
            () => {
              controller.abort()
              if (job.controller === controller && job.data.status === 'generating') {
                this.update(job, { status: 'error', error: 'interrupted' })
              }
            },
            5 * 60 * 1000
          )
          try {
            const configured = resolveConfiguredPaintingModel()
            if (!configured) {
              this.update(job, { status: 'error', error: 'configuration' })
              return
            }
            const inputs = job.data.inputFiles ?? []
            const modes = configured.support?.modes
            const mode: ImageGenerationMode | undefined = inputs.length
              ? ((['edit', 'generate', 'remix', 'upscale', 'merge'] as const).find((mode) => modes?.[mode]) ??
                (!modes ? 'generate' : undefined))
              : !modes || modes.generate
                ? 'generate'
                : undefined
            if (!mode || (inputs.length && !configured.acceptsImageInput)) {
              this.update(job, { status: 'error', error: inputs.length ? 'input_unsupported' : 'configuration' })
              return
            }
            const limit = modes?.[mode]?.maxInputImages
            if (limit !== undefined && inputs.length > limit) {
              this.update(job, { status: 'error', error: 'input_limit' })
              return
            }
            let inputImages: string[] | undefined
            try {
              if (inputs.length)
                inputImages = await Promise.all(
                  inputs.map(async ({ id }) => {
                    const { content, mime } = await application.get('FileManager').read(id, { encoding: 'base64' })
                    if (!mime.startsWith('image/') || !content) throw new Error('Input file is not a readable image')
                    return `data:${mime};base64,${content}`
                  })
                )
            } catch (error) {
              logger.warn('Illustration input unavailable', { error, messageId: job.target.messageId })
              if (job.controller === controller && job.data.status === 'generating')
                this.update(job, { status: 'error', error: 'input_unavailable' })
              return
            }
            if (job.controller !== controller || job.data.status !== 'generating' || controller.signal.aborted) return
            const { files } = await application.get('AiService').generateImage({
              uniqueModelId: configured.uniqueModelId,
              prompt: job.data.prompt,
              mode,
              ...(inputImages && { inputImages }),
              paramValues: extractParamValues({ prompt: job.data.prompt }, configured.support, mode),
              cleanupPolicy: 'delete_when_unreferenced',
              requestOptions: { signal: controller.signal }
            })
            // A cancelled attempt may resolve after a retry; only the current attempt can publish files.
            if (job.controller !== controller || job.data.status !== 'generating') return
            if (!files.length) throw new Error('Image generation returned no files')
            if (!job.persisted) this.retainFiles(job, files)
            this.update(job, { status: 'ready', files: files.map(({ id, name }) => ({ id, name })) })
          } catch (error) {
            if (job.controller !== controller || job.data.status !== 'generating') return
            logger.warn('Illustration generation failed', { error, messageId: job.target.messageId })
            this.update(job, { status: 'error', error: controller.signal.aborted ? 'interrupted' : 'generation' })
          } finally {
            clearTimeout(timer)
            activity.dispose()
          }
        },
        { signal: controller.signal }
      )
      .catch(() => {})
  }

  private update(job: IllustrationJob, change: Partial<IllustrationData>): void {
    job.data = { ...job.data, ...change, revision: job.data.revision + 1 }
    if (job.persisted) {
      this.patch(job.target, job.data)
      if (!['prompting', 'generating'].includes(job.data.status)) {
        job.detach?.()
        this.jobs.delete(job.target.id)
      }
    }
    application.get('IpcApiService').broadcast('ai.illustration.changed', { ...job.target, data: job.data })
  }

  private readParts(target: IllustrationTarget): CherryMessagePart[] | undefined {
    try {
      if (temporaryChatService.hasTopic(target.topicId)) {
        return temporaryChatService.listMessages(target.topicId).find((message) => message.id === target.messageId)
          ?.data.parts
      }
      const message = messageService.getById(target.messageId)
      return message.topicId === target.topicId ? message.data.parts : undefined
    } catch (error) {
      if (isDataApiNotFoundError(error)) return undefined
      throw error
    }
  }

  private patch(target: IllustrationTarget, data: IllustrationData): void {
    const parts = this.readParts(target)
    if (!parts?.some((part) => part.type === 'data-illustration' && part.data.id === target.id)) return
    const updated = parts.map((part) =>
      part.type === 'data-illustration' && part.data.id === target.id ? { ...part, data } : part
    )
    if (temporaryChatService.hasTopic(target.topicId)) {
      temporaryChatService.updateIllustrationParts(target.topicId, target.messageId, updated)
    } else messageService.update(target.messageId, { data: { parts: updated } })
    notifyDataApiDataChange([
      {
        endpoint: '/topics/:topicId/messages',
        kind: 'projection',
        routeParams: { topicId: target.topicId },
        entityIds: [target.messageId]
      },
      { endpoint: '/messages/:id', entityIds: [target.messageId] }
    ])
  }
}
