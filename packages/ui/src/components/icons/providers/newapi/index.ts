import type { CompoundIcon } from '../../types'
import { NewapiAvatar } from './avatar'
import { Newapi } from './color'
import { NewapiMono } from './mono'

export const NewapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Newapi, {
  Color: Newapi,
  Mono: NewapiMono,
  Avatar: NewapiAvatar,
  colorPrimary: '#000000'
})
export default NewapiIcon
