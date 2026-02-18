import { type CompoundIcon } from '../../types'
import { MetaAvatar } from './avatar'
import { Meta } from './color'
import { MetaMono } from './mono'

export const MetaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Meta, {
  Color: Meta,
  Mono: MetaMono,
  Avatar: MetaAvatar,
  colorPrimary: '#0081FB'
})

export default MetaIcon
