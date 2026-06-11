import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TogetherAvatar } from './avatar'
import { TogetherDark } from './dark'
import { TogetherLight } from './light'

const Together = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TogetherLight {...props} className={className} />
  if (variant === 'dark') return <TogetherDark {...props} className={className} />
  return (
    <>
      <TogetherLight className={cn(className, 'dark:hidden')} {...props} />
      <TogetherDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const TogetherIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Together, {
  Avatar: TogetherAvatar,
  colorPrimary: '#000000'
})

export default TogetherIcon
