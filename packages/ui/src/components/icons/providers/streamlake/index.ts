import { type CompoundIcon } from '../../types'
import { StreamlakeAvatar } from './avatar'
import { Streamlake } from './color'
import { StreamlakeMono } from './mono'

export const StreamlakeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Streamlake, {
  Color: Streamlake,
  Mono: StreamlakeMono,
  Avatar: StreamlakeAvatar,
  colorPrimary: '#1D70FF'
})

export default StreamlakeIcon
