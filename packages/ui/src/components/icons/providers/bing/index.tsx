import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BingAvatar } from './avatar'
import { BingDark } from './dark'
import { BingLight } from './light'

const Bing = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BingLight {...props} className={className} />
  if (variant === 'dark') return <BingDark {...props} className={className} />
  return (
    <>
      <BingLight className={cn('dark:hidden', className)} {...props} />
      <BingDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bing, {
  Avatar: BingAvatar,
  colorPrimary: '#000000'
})

export default BingIcon
