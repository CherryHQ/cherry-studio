import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

interface FileProcessingTaskStoreEntry<TState> {
  processorId: FileProcessorId
  state: TState
  createdAt: number
  updatedAt: number
}

function buildTaskStoreKey(processorId: FileProcessorId, providerTaskId: string): string {
  return `${processorId}:${providerTaskId}`
}

export class FileProcessingTaskStore {
  private readonly tasks = new Map<string, FileProcessingTaskStoreEntry<unknown>>()

  create<TState>(processorId: FileProcessorId, providerTaskId: string, state: TState): TState {
    const key = buildTaskStoreKey(processorId, providerTaskId)
    const now = Date.now()

    this.tasks.set(key, {
      processorId,
      state,
      createdAt: now,
      updatedAt: now
    })

    return state
  }

  get<TState>(processorId: FileProcessorId, providerTaskId: string): TState | undefined {
    const key = buildTaskStoreKey(processorId, providerTaskId)
    const task = this.tasks.get(key)

    return task?.state as TState | undefined
  }

  update<TState>(processorId: FileProcessorId, providerTaskId: string, updater: (current: TState) => TState): TState {
    const key = buildTaskStoreKey(processorId, providerTaskId)
    const current = this.tasks.get(key)

    if (!current) {
      throw new Error(`File processing task not found for ${processorId}:${providerTaskId}`)
    }

    const nextState = updater(current.state as TState)

    this.tasks.set(key, {
      processorId,
      state: nextState,
      createdAt: current.createdAt,
      updatedAt: Date.now()
    })

    return nextState
  }

  delete(processorId: FileProcessorId, providerTaskId: string): boolean {
    const key = buildTaskStoreKey(processorId, providerTaskId)
    return this.tasks.delete(key)
  }

  clear(): void {
    this.tasks.clear()
  }
}

export const fileProcessingTaskStore = new FileProcessingTaskStore()
