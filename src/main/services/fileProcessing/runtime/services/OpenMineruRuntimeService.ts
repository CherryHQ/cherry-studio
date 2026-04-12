import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('OpenMineruRuntimeService')

interface OpenMineruTaskExecution {
  controller: AbortController
  promise: Promise<void>
}

@Injectable('OpenMineruRuntimeService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['FileProcessingRuntimeService'])
export class OpenMineruRuntimeService extends BaseService {
  private readonly inFlightTasks = new Map<string, OpenMineruTaskExecution>()
  private acceptingTasks = false

  protected async onInit(): Promise<void> {
    this.acceptingTasks = true
  }

  protected async onStop(): Promise<void> {
    this.acceptingTasks = false

    const inFlightTasks = Array.from(this.inFlightTasks.values())

    for (const task of inFlightTasks) {
      task.controller.abort()
    }

    await Promise.allSettled(inFlightTasks.map((task) => task.promise))
    this.inFlightTasks.clear()

    logger.debug('Open MinerU runtime cleanup completed', {
      abortedTaskCount: inFlightTasks.length
    })
  }

  startTask(providerTaskId: string, runner: (signal: AbortSignal) => Promise<void>): void {
    if (!this.acceptingTasks) {
      throw new Error('OpenMineruRuntimeService is not initialized')
    }

    if (this.inFlightTasks.has(providerTaskId)) {
      throw new Error(`Open MinerU task is already running: ${providerTaskId}`)
    }

    const controller = new AbortController()
    const promise = this.runTask(runner, controller.signal)
      .catch((error) => {
        logger.error('Open MinerU background task failed', error as Error, {
          providerTaskId
        })
      })
      .finally(() => {
        const current = this.inFlightTasks.get(providerTaskId)

        if (current?.promise === promise) {
          this.inFlightTasks.delete(providerTaskId)
        }
      })

    this.inFlightTasks.set(providerTaskId, {
      controller,
      promise
    })
  }

  private runTask(runner: (signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void> {
    try {
      return runner(signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
