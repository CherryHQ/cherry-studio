import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ModelscopeAvatar } from './avatar'
import { ModelscopeDark } from './dark'
import { ModelscopeLight } from './light'

const Modelscope = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ModelscopeLight {...props} className={className} />
  if (variant === 'dark') return <ModelscopeDark {...props} className={className} />
  return (
    <>
      <ModelscopeLight className={cn('dark:hidden', className)} {...props} />
      <ModelscopeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ModelscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Modelscope, {
  Avatar: ModelscopeAvatar,
  colorPrimary: '#624AFF'
})

export default ModelscopeIcon
