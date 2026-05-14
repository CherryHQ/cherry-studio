import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BurncloudAvatar } from './avatar'
import { BurncloudDark } from './dark'
import { BurncloudLight } from './light'

const Burncloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BurncloudLight {...props} className={className} />
  if (variant === 'dark') return <BurncloudDark {...props} className={className} />
  return (
    <>
      <BurncloudLight className={cn('dark:hidden', className)} {...props} />
      <BurncloudDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BurncloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Burncloud, {
  Avatar: BurncloudAvatar,
  colorPrimary: '#000000'
})

export default BurncloudIcon
