import type { CompoundIcon } from '../../types'
import { Meta } from './color'
import { MetaMono } from './mono'

export const MetaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Meta, {
  Color: Meta,
  Mono: MetaMono,
  colorPrimary: '#0081FB'
})
export default MetaIcon
