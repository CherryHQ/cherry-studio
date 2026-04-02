import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

import { FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS, FileProcessingTaskRuntime } from '../task/FileProcessingTaskRuntime'

const logger = loggerService.withContext('FileProcessingRuntimeService')

@Injectable('FileProcessingRuntimeService')
@ServicePhase(Phase.BeforeReady)
export class FileProcessingRuntimeService extends BaseService {
  private taskRuntime: FileProcessingTaskRuntime | null = null

  protected async onInit(): Promise<void> {
    this.taskRuntime = new FileProcessingTaskRuntime({
      autoPruneIntervalMs: FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS
    })

    logger.info('FileProcessingRuntimeService initialized')
  }

  protected async onStop(): Promise<void> {
    if (!this.taskRuntime) {
      return
    }

    this.taskRuntime.clear()
    this.taskRuntime.destroy()
    this.taskRuntime = null

    logger.debug('FileProcessingRuntimeService cleanup completed')
  }

  createTask<TState>(processorId: FileProcessorId, providerTaskId: string, state: TState): TState {
    return this.getRequiredTaskRuntime().create(processorId, providerTaskId, state)
  }

  getTask<TState>(processorId: FileProcessorId, providerTaskId: string): TState | undefined {
    return this.getRequiredTaskRuntime().get<TState>(processorId, providerTaskId)
  }

  updateTask<TState>(
    processorId: FileProcessorId,
    providerTaskId: string,
    updater: (current: TState) => TState
  ): TState {
    return this.getRequiredTaskRuntime().update(processorId, providerTaskId, updater)
  }

  deleteTask(processorId: FileProcessorId, providerTaskId: string): boolean {
    return this.getRequiredTaskRuntime().delete(processorId, providerTaskId)
  }

  clearTasks(): void {
    this.getRequiredTaskRuntime().clear()
  }

  private getRequiredTaskRuntime(): FileProcessingTaskRuntime {
    if (!this.taskRuntime) {
      throw new Error('FileProcessingRuntimeService is not initialized')
    }

    return this.taskRuntime
  }
}
