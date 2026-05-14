import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LambdaAvatar } from './avatar'
import { LambdaLight } from './light'

const Lambda = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LambdaLight {...props} className={className} />
  return <LambdaLight {...props} className={className} />
}

export const LambdaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lambda, {
  Avatar: LambdaAvatar,
  colorPrimary: '#000000'
})

export default LambdaIcon
