import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DifyAvatar } from './avatar'
import { DifyLight } from './light'

const Dify = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DifyLight {...props} className={className} />
  return <DifyLight {...props} className={className} />
}

export const DifyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dify, {
  Avatar: DifyAvatar,
  colorPrimary: '#FDFEFF'
})

export default DifyIcon
