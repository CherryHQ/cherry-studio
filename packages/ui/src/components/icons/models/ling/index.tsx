import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LingAvatar } from './avatar'
import { LingDark } from './dark'
import { LingLight } from './light'

const Ling = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LingLight {...props} className={className} />
  if (variant === 'dark') return <LingDark {...props} className={className} />
  return (
    <>
      <LingLight className={cn('dark:hidden', className)} {...props} />
      <LingDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ling, {
  Avatar: LingAvatar,
  colorPrimary: '#0C73FF'
})

export default LingIcon
