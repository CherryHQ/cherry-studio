import type { TokenFluxPainting } from '@renderer/types'
import { uuid } from '@renderer/utils'

import type { DynamicFormSchemaProperty, DynamicFormValue } from '../types'

export type TokenFluxFormData = Record<string, DynamicFormValue>

interface TokenFluxPricing {
  price: string | number
  currency: string
  unit: number
}

export interface TokenFluxModel {
  id: string
  name: string
  model_provider: string
  description: string
  tags: string[]
  pricing?: TokenFluxPricing
  input_schema: {
    type: string
    properties: Record<string, DynamicFormSchemaProperty>
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
