import PQueue from 'p-queue'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn } from '@main/core/lifecycle'
import type {
  UtilityProcessClient,
  UtilityProcessContract,
  UtilityProcessDefinition,
  UtilityProcessRequestOptions,
  UtilityProcessStreamOptions,
  UtilityProcessStreams,
  UtilityProcessStream
} from '@main/core/utilityProcess/types'
import { UtilityProcessError, isUtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import type { LocalModelBundleId, LocalModelCapability } from '@shared/data/presets/localModel'

import { getModelBundle } from '../catalog/catalog'
import { localModelStorageService } from '../installation/LocalModelStorageService'

/**
 * Shared host for local inference utility processes. Each capability gets its own process,
 * so stopping or removing one model cannot reject another capability's in-flight request.
 *
 * Process spawning, cancellation, idle release and maintenance barriers belong to
 * `core/utilityProcess`. This layer serializes native inference calls, checks platform
 * support and restarts a process when its hardware profile becomes stale.
 */
// Inherited by the concrete services; a subclass declaring its own @DependsOn would replace it.
@DependsOn(['UtilityProcessManager'])
export abstract class InferenceServiceBase<Contract extends UtilityProcessContract> extends BaseService {
  private readonly queue = new PQueue({ concurrency: 1 })
  private residentModelId: LocalModelBundleId | null = null
  private readonly removingModels = new Set<LocalModelBundleId>()
  private readonly modelGenerations = new Map<LocalModelBundleId, number>()
  private launchedProfileId: string | null = null
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(
    private readonly definition: UtilityProcessDefinition<Contract, unknown> & {
      resolveRuntimeProfile?: () => { id: string }
    },
    private readonly capability: LocalModelCapability
  ) {
    super()
    this.logger = loggerService.withContext(`InferenceService:${capability}`)
  }

  protected onInit(): void {
    application.get('UtilityProcessManager').register(this.definition)
  }

  private get client(): UtilityProcessClient<Contract> {
    return application.get('UtilityProcessManager').client(this.definition)
  }

  protected async run<M extends keyof Contract['methods'] & string>(
    modelId: LocalModelBundleId,
    method: M,
    prepareInput: () => Contract['methods'][M]['input'],
    options: UtilityProcessRequestOptions<Contract['methods'][M]['event']> = {}
  ): Promise<Contract['methods'][M]['output']> {
    return this.enqueue(modelId, options.signal, async () => this.request(method, prepareInput(), options))
  }

  protected openStream<M extends keyof UtilityProcessStreams<Contract> & string>(
    modelId: LocalModelBundleId,
    method: M,
    prepareInput: () => UtilityProcessStreams<Contract>[M]['request'],
    options: UtilityProcessStreamOptions
  ): Promise<
    UtilityProcessStream<
      UtilityProcessStreams<Contract>[M]['input'],
      UtilityProcessStreams<Contract>[M]['output'],
      UtilityProcessStreams<Contract>[M]['result']
    >
  > {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(options.signal?.reason)
      options.signal?.addEventListener('abort', aborted, { once: true })
      void this.enqueue(modelId, options.signal, async () => {
        const stream = await this.client.openStream(method, prepareInput(), options)
        resolve(stream)
        await stream.closed
      })
        .catch(reject)
        .finally(() => options.signal?.removeEventListener('abort', aborted))
    })
  }

  private async enqueue<T>(
    modelId: LocalModelBundleId,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    const unsupportedArtifact = getModelBundle(modelId).requires.find(
      (id) => !localModelStorageService.isArtifactSupported(id)
    )
    if (unsupportedArtifact) {
      throw new Error(
        `Local ${this.capability} inference is not supported on this platform: ${unsupportedArtifact} is unavailable.`
      )
    }
    this.assertModelAvailable(modelId)
    const generation = this.modelGenerations.get(modelId) ?? 0
    signal?.throwIfAborted()
    // PQueue adds void only for its own signal cancellation; this queue handles cancellation inside the task.
    return (await this.queue.add(async () => {
      signal?.throwIfAborted()
      this.assertModelAvailable(modelId, generation)
      if (this.residentModelId !== null && this.residentModelId !== modelId) {
        await this.client.stop()
        this.residentModelId = null
      }
      await this.restartIfRuntimeChanged()
      signal?.throwIfAborted()
      this.assertModelAvailable(modelId, generation)
      this.residentModelId = modelId
      return operation()
    })) as T
  }

  private async request<M extends keyof Contract['methods'] & string>(
    method: M,
    input: Contract['methods'][M]['input'],
    options: UtilityProcessRequestOptions<Contract['methods'][M]['event']>
  ): Promise<Contract['methods'][M]['output']> {
    try {
      return await this.client.request(method, input, options)
    } catch (error) {
      if (isUtilityProcessError(error, 'PROCESS_REMOTE_ERROR') && error.cause instanceof Error) throw error.cause
      throw error
    }
  }

  private async restartIfRuntimeChanged(): Promise<void> {
    const profile = this.definition.resolveRuntimeProfile?.()
    if (!profile) return
    if (this.launchedProfileId !== null && this.launchedProfileId !== profile.id) {
      this.logger.info('inference runtime configuration changed; restarting process')
      await this.client.stop()
    }
    this.launchedProfileId = profile.id
  }

  async terminate(): Promise<void> {
    await this.client.stop()
  }

  private assertModelAvailable(
    modelId: LocalModelBundleId,
    generation = this.modelGenerations.get(modelId) ?? 0
  ): void {
    if (this.removingModels.has(modelId) || generation !== (this.modelGenerations.get(modelId) ?? 0)) {
      throw new UtilityProcessError('PROCESS_BLOCKED', 'The selected model is being removed', {
        processId: this.definition.id
      })
    }
  }

  async removeModelThen<T>(modelId: LocalModelBundleId, after: () => Promise<T>): Promise<T> {
    this.assertModelAvailable(modelId)
    this.removingModels.add(modelId)
    this.modelGenerations.set(modelId, (this.modelGenerations.get(modelId) ?? 0) + 1)
    try {
      if (this.residentModelId === modelId) {
        return await this.client.withStopped(async () => {
          this.residentModelId = null
          return after()
        })
      }
      return await after()
    } finally {
      this.removingModels.delete(modelId)
    }
  }
}
