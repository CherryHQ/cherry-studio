import type { DataRequest, DataResponse, HttpMethod } from '@shared/data/api/types'

import type { CoreCommands, SerializedError, WorkerMessage } from '../worker/protocol'

export class CoreWorkerError extends Error {
  readonly code?: string

  constructor(error: SerializedError) {
    super(error.message)
    this.name = error.name
    this.code = error.code
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** Page-side handle to a Core Worker. */
export class CoreClient {
  readonly #worker: Worker
  readonly #pending = new Map<number, Pending>()
  readonly #listeners = new Set<(channel: string, args: unknown[]) => void>()
  #nextId = 1

  constructor(worker: Worker) {
    this.#worker = worker
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.kind === 'broadcast') {
        for (const listener of this.#listeners) listener(message.channel, message.args)
        return
      }
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new CoreWorkerError(message.error))
    })
    // A Worker that fails to load or throws at top level never replies; fail its callers instead.
    worker.addEventListener('error', (event) => {
      const error = new CoreWorkerError({ name: 'CoreWorkerCrashed', message: event.message || 'Core Worker failed' })
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
    })
  }

  send<K extends keyof CoreCommands>(
    command: K,
    payload: CoreCommands[K]['payload']
  ): Promise<CoreCommands[K]['result']>
  send<T = unknown>(command: string, payload?: unknown): Promise<T>
  send(command: string, payload?: unknown): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#worker.postMessage({ id, command, payload })
    })
  }

  open(account: string, handoverTimeoutMs?: number) {
    return this.send('open', { account, handoverTimeoutMs })
  }

  request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: Pick<DataRequest, 'params' | 'body'> = {}
  ): Promise<DataResponse<T>> {
    return this.send('request', { id: crypto.randomUUID(), method, path, ...options }) as Promise<DataResponse<T>>
  }

  /** Subscribes to what the Worker sends the page, such as `DataApi_DataChanged`. */
  onBroadcast(listener: (channel: string, args: unknown[]) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
