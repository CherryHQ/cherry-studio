import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51ChatAvatar } from './avatar'
import { Gpt51ChatDark } from './dark'
import { Gpt51ChatLight } from './light'

const Gpt51Chat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51ChatLight {...props} className={className} />
  if (variant === 'dark') return <Gpt51ChatDark {...props} className={className} />
  return (
    <>
      <Gpt51ChatLight className={cn('dark:hidden', className)} {...props} />
      <Gpt51ChatDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt51ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Chat, {
  Avatar: Gpt51ChatAvatar,
  colorPrimary: '#000000'
})

export default Gpt51ChatIcon
