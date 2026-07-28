import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ExaAvatar } from './avatar'
import { ExaLight } from './light'

const Exa = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ExaLight {...props} className={className} />
  return <ExaLight {...props} className={className} />
}

export const ExaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Exa, {
  Avatar: ExaAvatar,
  colorPrimary: '#1F40ED'
})

export default ExaIcon
