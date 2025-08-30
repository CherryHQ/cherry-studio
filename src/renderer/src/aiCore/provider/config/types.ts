import type { Model, Provider } from '@renderer/types'

export interface ModelRule {
  name: string
  match: (model: Model) => boolean
  provider: (provider: Provider) => Provider
}
