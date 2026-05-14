import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HunyuanAvatar } from './avatar'
import { HunyuanDark } from './dark'
import { HunyuanLight } from './light'

const Hunyuan = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HunyuanLight {...props} className={className} />
  if (variant === 'dark') return <HunyuanDark {...props} className={className} />
  return (
    <>
      <HunyuanLight className={cn('dark:hidden', className)} {...props} />
      <HunyuanDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HunyuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hunyuan, {
  Avatar: HunyuanAvatar,
  colorPrimary: '#0054E0'
})

export default HunyuanIcon
