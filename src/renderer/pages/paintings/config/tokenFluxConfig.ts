import type { TokenFluxPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

export interface TokenFluxModel {
  id: string
  name: string
  model_provider: string
  description: string
  tags: string[]
  pricing: any
  input_schema: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
}

export const DEFAULT_TOKENFLUX_PAINTING: TokenFluxPainting = {
  id: uuid(),
  model: '',
  prompt: '',
  inputParams: {},
  status: 'starting',
  generationId: undefined,
  urls: [],
  files: []
}
