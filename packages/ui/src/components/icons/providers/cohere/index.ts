import type { CompoundIcon } from '../../types'
import { CohereAvatar } from './avatar'
import { Cohere } from './color'
import { CohereMono } from './mono'

export const CohereIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cohere, {
  Color: Cohere,
  Mono: CohereMono,
  Avatar: CohereAvatar,
  colorPrimary: '#39594D'
})
export default CohereIcon
