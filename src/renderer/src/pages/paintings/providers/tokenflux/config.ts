import { uuid } from '@renderer/utils'

import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'

export const DEFAULT_TOKENFLUX_PAINTING: TokenFluxPainting = {
  id: uuid(),
  providerId: 'tokenflux',
  mode: 'generate',
  model: '',
  prompt: '',
  inputParams: {},
  files: []
}
