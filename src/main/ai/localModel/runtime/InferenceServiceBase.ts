import PQueue from 'p-queue'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn } from '@main/core/lifecycle'
import type {
  UtilityProcessClient,
  UtilityProcessContract,
  UtilityProcessDefinition,
  UtilityProcessRequestOptions
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
    if (options.signal?.aborted) throw options.signal.reason
    // The cast is p-queue's `T | void`: it resolves to void only when an AbortSignal is
    // passed to `add`, which this never does. Treating undefined as a failure would reject
    // every method whose output is void, `load` included.
    return await this.queue.add(async () => {
      options.signal?.throwIfAborted()
      this.assertModelAvailable(modelId, generation)
      if (this.residentModelId !== null && this.residentModelId !== modelId) {
        await this.client.stop()
        this.residentModelId = null
      }
      await this.restartIfRuntimeChanged()
      options.signal?.throwIfAborted()
      this.assertModelAvailable(modelId, generation)
      const input = prepareInput()
      this.residentModelId = modelId
      return this.request(method, input, options)
    })
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
