import { type CompoundIcon } from '../../types'
import { MetasoAvatar } from './avatar'
import { Metaso } from './color'
import { MetasoMono } from './mono'

export const MetasoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Metaso, {
  Color: Metaso,
  Mono: MetasoMono,
  Avatar: MetasoAvatar,
  colorPrimary: '#175CD3'
})

export default MetasoIcon
