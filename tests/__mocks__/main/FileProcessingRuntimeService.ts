function buildTaskKey(processorId: string, providerTaskId: string): string {
  return `${processorId}:${providerTaskId}`
}

function createMockFileProcessingTaskStore() {
  const tasks = new Map<string, unknown>()

  return {
    create<TState>(processorId: string, providerTaskId: string, state: TState): TState {
      tasks.set(buildTaskKey(processorId, providerTaskId), state)
      return state
    },
    get<TState>(processorId: string, providerTaskId: string): TState | undefined {
      return tasks.get(buildTaskKey(processorId, providerTaskId)) as TState | undefined
    },
    update<TState>(processorId: string, providerTaskId: string, updater: (current: TState) => TState): TState {
      const key = buildTaskKey(processorId, providerTaskId)
      const current = tasks.get(key) as TState | undefined

      if (current === undefined) {
        throw new Error(`File processing task not found for ${processorId}:${providerTaskId}`)
      }

      const nextState = updater(current)
      tasks.set(key, nextState)
      return nextState
    },
    delete(processorId: string, providerTaskId: string): boolean {
      return tasks.delete(buildTaskKey(processorId, providerTaskId))
    },
    clear(): void {
      tasks.clear()
    },
    destroy(): void {}
  }
}

export const mockFileProcessingTaskStore = createMockFileProcessingTaskStore()

export const MockMainFileProcessingRuntimeServiceExport = {
  fileProcessingRuntimeService: {
    createTask: mockFileProcessingTaskStore.create,
    getTask: mockFileProcessingTaskStore.get,
    updateTask: mockFileProcessingTaskStore.update,
    deleteTask: mockFileProcessingTaskStore.delete,
    clearTasks: mockFileProcessingTaskStore.clear
  }
}
