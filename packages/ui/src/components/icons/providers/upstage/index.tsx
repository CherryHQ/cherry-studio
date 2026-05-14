import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { UpstageAvatar } from './avatar'
import { UpstageDark } from './dark'
import { UpstageLight } from './light'

const Upstage = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <UpstageLight {...props} className={className} />
  if (variant === 'dark') return <UpstageDark {...props} className={className} />
  return (
    <>
      <UpstageLight className={cn('dark:hidden', className)} {...props} />
      <UpstageDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const UpstageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Upstage, {
  Avatar: UpstageAvatar,
  colorPrimary: '#8867FB'
})

export default UpstageIcon
