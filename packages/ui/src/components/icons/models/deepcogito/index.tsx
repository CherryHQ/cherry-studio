import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeepcogitoAvatar } from './avatar'
import { DeepcogitoLight } from './light'

const Deepcogito = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeepcogitoLight {...props} className={className} />
  return <DeepcogitoLight {...props} className={className} />
}

export const DeepcogitoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepcogito, {
  Avatar: DeepcogitoAvatar,
  colorPrimary: '#4E81EE'
})

export default DeepcogitoIcon
