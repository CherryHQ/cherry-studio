import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaichuanAvatar } from './avatar'
import { BaichuanDark } from './dark'
import { BaichuanLight } from './light'

const Baichuan = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaichuanLight {...props} className={className} />
  if (variant === 'dark') return <BaichuanDark {...props} className={className} />
  return (
    <>
      <BaichuanLight className={cn('dark:hidden', className)} {...props} />
      <BaichuanDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BaichuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baichuan, {
  Avatar: BaichuanAvatar,
  colorPrimary: '#000000'
})

export default BaichuanIcon
