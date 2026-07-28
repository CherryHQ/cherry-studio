import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MonicaAvatar } from './avatar'
import { MonicaLight } from './light'

const Monica = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MonicaLight {...props} className={className} />
  return <MonicaLight {...props} className={className} />
}

export const MonicaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Monica, {
  Avatar: MonicaAvatar,
  colorPrimary: '#1E1E1E'
})

export default MonicaIcon
