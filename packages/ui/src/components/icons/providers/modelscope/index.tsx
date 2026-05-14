import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ModelscopeAvatar } from './avatar'
import { ModelscopeLight } from './light'

const Modelscope = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ModelscopeLight {...props} className={className} />
  return <ModelscopeLight {...props} className={className} />
}

export const ModelscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Modelscope, {
  Avatar: ModelscopeAvatar,
  colorPrimary: '#624AFF'
})

export default ModelscopeIcon
