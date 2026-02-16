import type { CompoundIcon } from '../../types'
import { Suno } from './color'
import { SunoMono } from './mono'

export const SunoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Suno, {
  Color: Suno,
  Mono: SunoMono,
  colorPrimary: '#FEFEFE'
})
export default SunoIcon
