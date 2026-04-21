import type { ResourceType } from '../types'

export class PendingBackendError extends Error {
  constructor(public readonly resource: ResourceType) {
    super(`Backend for resource "${resource}" is not ready yet.`)
    this.name = 'PendingBackendError'
  }
}
