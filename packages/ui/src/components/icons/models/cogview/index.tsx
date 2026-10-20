import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CogviewAvatar } from './avatar'
import { CogviewLight } from './light'

const Cogview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CogviewLight {...props} className={className} />
  return <CogviewLight {...props} className={className} />
}

export const CogviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cogview, {
  Avatar: CogviewAvatar,
  colorPrimary: '#000000'
})

export default CogviewIcon
