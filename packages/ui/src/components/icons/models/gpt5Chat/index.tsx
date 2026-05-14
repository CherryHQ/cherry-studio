import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5ChatAvatar } from './avatar'
import { Gpt5ChatDark } from './dark'
import { Gpt5ChatLight } from './light'

const Gpt5Chat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5ChatLight {...props} className={className} />
  if (variant === 'dark') return <Gpt5ChatDark {...props} className={className} />
  return (
    <>
      <Gpt5ChatLight className={cn('dark:hidden', className)} {...props} />
      <Gpt5ChatDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt5ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Chat, {
  Avatar: Gpt5ChatAvatar,
  colorPrimary: '#000000'
})

export default Gpt5ChatIcon
