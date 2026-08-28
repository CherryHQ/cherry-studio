import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LiquidAvatar } from './avatar'
import { LiquidDark } from './dark'
import { LiquidLight } from './light'

const Liquid = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LiquidLight {...props} className={className} />
  if (variant === 'dark') return <LiquidDark {...props} className={className} />
  return (
    <>
      <LiquidLight className={cn('dark:hidden', className)} {...props} />
      <LiquidDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LiquidIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Liquid, {
  Avatar: LiquidAvatar,
  colorPrimary: '#000000'
})

export default LiquidIcon
