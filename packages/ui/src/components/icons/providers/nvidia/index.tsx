import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NvidiaAvatar } from './avatar'
import { NvidiaDark } from './dark'
import { NvidiaLight } from './light'

const Nvidia = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NvidiaLight {...props} className={className} />
  if (variant === 'dark') return <NvidiaDark {...props} className={className} />
  return (
    <>
      <NvidiaLight className={cn('dark:hidden', className)} {...props} />
      <NvidiaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NvidiaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nvidia, {
  Avatar: NvidiaAvatar,
  colorPrimary: '#76B900'
})

export default NvidiaIcon
