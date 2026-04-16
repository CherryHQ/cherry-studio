import { type CompoundIcon } from '../../types'
import { DuckAvatar } from './avatar'
import { Duck } from './color'
import { DuckMono } from './mono'

export const DuckIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Duck, {
  Color: Duck,
  Mono: DuckMono,
  Avatar: DuckAvatar,
  colorPrimary: '#DE5833'
})

export default DuckIcon
