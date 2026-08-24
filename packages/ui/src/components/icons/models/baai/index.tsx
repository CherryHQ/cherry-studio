import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaaiAvatar } from './avatar'
import { BaaiDark } from './dark'
import { BaaiLight } from './light'

const Baai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaaiLight {...props} className={className} />
  if (variant === 'dark') return <BaaiDark {...props} className={className} />
  return (
    <>
      <BaaiLight className={cn('dark:hidden', className)} {...props} />
      <BaaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BaaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baai, {
  Avatar: BaaiAvatar,
  colorPrimary: '#000000'
})

export default BaaiIcon
