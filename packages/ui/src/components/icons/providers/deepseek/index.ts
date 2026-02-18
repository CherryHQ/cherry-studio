import { type CompoundIcon } from '../../types'
import { DeepseekAvatar } from './avatar'
import { Deepseek } from './color'
import { DeepseekMono } from './mono'

export const DeepseekIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepseek, {
  Color: Deepseek,
  Mono: DeepseekMono,
  Avatar: DeepseekAvatar,
  colorPrimary: '#4D6BFE'
})

export default DeepseekIcon
