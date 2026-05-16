import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenclawAvatar } from './avatar'
import { OpenclawLight } from './light'

const Openclaw = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenclawLight {...props} className={className} />
  return <OpenclawLight {...props} className={className} />
}

export const OpenclawIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openclaw, {
  Avatar: OpenclawAvatar,
  colorPrimary: '#FF4D4D'
})

export default OpenclawIcon
