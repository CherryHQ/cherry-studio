import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeepseekAvatar } from './avatar'
import { DeepseekDark } from './dark'
import { DeepseekLight } from './light'

const Deepseek = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeepseekLight {...props} className={className} />
  if (variant === 'dark') return <DeepseekDark {...props} className={className} />
  return (
    <>
      <DeepseekLight className={cn('dark:hidden', className)} {...props} />
      <DeepseekDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DeepseekIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepseek, {
  Avatar: DeepseekAvatar,
  colorPrimary: '#4D6BFE'
})

export default DeepseekIcon
