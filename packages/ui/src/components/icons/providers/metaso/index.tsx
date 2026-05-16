import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MetasoAvatar } from './avatar'
import { MetasoLight } from './light'

const Metaso = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MetasoLight {...props} className={className} />
  return <MetasoLight {...props} className={className} />
}

export const MetasoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Metaso, {
  Avatar: MetasoAvatar,
  colorPrimary: '#175CD3'
})

export default MetasoIcon
