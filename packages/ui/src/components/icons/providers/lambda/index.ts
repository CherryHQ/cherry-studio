import { type CompoundIcon } from '../../types'
import { LambdaAvatar } from './avatar'
import { Lambda } from './color'
import { LambdaMono } from './mono'

export const LambdaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lambda, {
  Color: Lambda,
  Mono: LambdaMono,
  Avatar: LambdaAvatar,
  colorPrimary: '#000000'
})

export default LambdaIcon
