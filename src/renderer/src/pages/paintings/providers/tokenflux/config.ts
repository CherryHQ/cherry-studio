import { uuid } from '@renderer/utils'

import type { PaintingData } from '../../model/types/paintingData'

/**
 * Tokenflux carries its schema-driven form values in `params.inputParams`. The
 * registry's per-model `imageGeneration.inputSchema` (JSON Schema) renders via
 * `TokenFluxSetting`; values land here keyed by JSON Schema property name.
 */
export type TokenFluxPainting = PaintingData & {
  params?: PaintingData['params'] & { inputParams?: Record<string, unknown> }
}

export const DEFAULT_TOKENFLUX_PAINTING: TokenFluxPainting = {
  id: uuid(),
  providerId: 'tokenflux',
  mode: 'generate',
  prompt: '',
  files: [],
  params: { inputParams: {} }
}
