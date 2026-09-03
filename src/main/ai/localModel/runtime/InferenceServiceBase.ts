import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn } from '@main/core/lifecycle'
import type {
  UtilityProcessClient,
  UtilityProcessContract,
  UtilityProcessDefinition,
  UtilityProcessRequestOptions
} from '@main/core/utilityProcess/types'
import { isUtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import type { LocalModelCapability } from '@shared/data/presets/localModel'
import PQueue from 'p-queue'

import { bundleForCapability } from '../catalog/catalog'
import { localModelStorageService } from '../installation/LocalModelStorageService'
import { resolveLocalInferenceProfile } from './inferenceAcceleration'
import type { InferenceInitData } from './protocol'

/**
 * Shared host for local inference utility processes. Each capability gets its own process,
 * so stopping or removing one model cannot reject another capability's in-flight request.
 *
 * Process spawning, cancellation, idle release and maintenance barriers belong to
 * `core/utilityProcess`. This layer serializes native inference calls, checks platform
 * support and restarts a process when its proxy or hardware profile becomes stale.
 */
// Inherited by the concrete services; a subclass declaring its own @DependsOn would replace it.
@DependsOn(['UtilityProcessManager'])
export abstract class InferenceServiceBase<Contract extends UtilityProcessContract> extends BaseService {
  private readonly queue = new PQueue({ concurrency: 1 })
  private launchedWith: string | null = null
  private readonly logger: ReturnType<typeof loggerService.withContext>

  protected constructor(
    private readonly definition: UtilityProcessDefinition<Contract, InferenceInitData>,
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
    method: M,
    input: Contract['methods'][M]['input'],
    options: UtilityProcessRequestOptions<Contract['methods'][M]['event']> = {}
  ): Promise<Contract['methods'][M]['output']> {
    const unsupportedArtifact = bundleForCapability(this.capability).requires.find(
      (id) => !localModelStorageService.isArtifactSupported(id)
    )
    if (unsupportedArtifact) {
      throw new Error(
        `Local ${this.capability} inference is not supported on this platform: ${unsupportedArtifact} is unavailable.`
      )
    }
    if (options.signal?.aborted) throw options.signal.reason
    // The cast is p-queue's `T | void`: it resolves to void only when an AbortSignal is
    // passed to `add`, which this never does. Treating undefined as a failure would reject
    // every method whose output is void, `load` included.
    return (await this.queue.add(async () => {
      await this.restartIfRuntimeChanged()
      return this.request(method, input, options)
    })) as Contract['methods'][M]['output']
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
    const routing = await application.get('ProxyService').getRoutingSnapshot()
    const profile = resolveLocalInferenceProfile(
      application.get('PreferenceService').get('feature.local_model.hardware_acceleration.enabled')
    )
    const key = `${routing.version}|${profile.id}`
    if (this.launchedWith !== null && this.launchedWith !== key) {
      this.logger.info('inference runtime configuration changed; restarting process')
      await this.client.stop()
    }
    this.launchedWith = key
  }

  async terminate(): Promise<void> {
    await this.client.stop()
  }

  async terminateThen<T>(after: () => Promise<T>): Promise<T> {
    return this.client.withStopped(after)
  }
}
