import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SensenovaAvatar } from './avatar'
import { SensenovaLight } from './light'

const Sensenova = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SensenovaLight {...props} className={className} />
  return <SensenovaLight {...props} className={className} />
}

export const SensenovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensenova, {
  Avatar: SensenovaAvatar,
  colorPrimary: '#01FFB9'
})

export default SensenovaIcon
