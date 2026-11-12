export interface AttachmentWorkerTasks {
  decode: { input: { content: Uint8Array; conservative: boolean }; result: string | null }
  allocate: { input: { bodies: readonly string[]; tokens: number }; result: number[] }
}

export type AttachmentWorkerInput = {
  [K in keyof AttachmentWorkerTasks]: { type: K; input: AttachmentWorkerTasks[K]['input'] }
}[keyof AttachmentWorkerTasks]

export type AttachmentWorkerMessage<T> =
  | { type: 'result'; value: T }
  | { type: 'log'; level: 'warn' | 'error'; message: string }
