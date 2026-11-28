import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HailuoAvatar } from './avatar'
import { HailuoDark } from './dark'
import { HailuoLight } from './light'

const Hailuo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HailuoLight {...props} className={className} />
  if (variant === 'dark') return <HailuoDark {...props} className={className} />
  return (
    <>
      <HailuoLight className={cn('dark:hidden', className)} {...props} />
      <HailuoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HailuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hailuo, {
  Avatar: HailuoAvatar,
  colorPrimary: '#000000'
})

export default HailuoIcon
