import type { CompoundIcon } from '../../types'
import { SunoAvatar } from './avatar'
import { Suno } from './color'
import { SunoMono } from './mono'

export const SunoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Suno, {
  Color: Suno,
  Mono: SunoMono,
  Avatar: SunoAvatar,
  colorPrimary: '#FEFEFE'
})
export default SunoIcon
