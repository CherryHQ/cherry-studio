import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SunoAvatar } from './avatar'
import { SunoLight } from './light'

const Suno = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SunoLight {...props} className={className} />
  return <SunoLight {...props} className={className} />
}

export const SunoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Suno, {
  Avatar: SunoAvatar,
  colorPrimary: '#FEFEFE'
})

export default SunoIcon
