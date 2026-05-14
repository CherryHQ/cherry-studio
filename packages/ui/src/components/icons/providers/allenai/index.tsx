import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AllenaiAvatar } from './avatar'
import { AllenaiDark } from './dark'
import { AllenaiLight } from './light'

const Allenai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AllenaiLight {...props} className={className} />
  if (variant === 'dark') return <AllenaiDark {...props} className={className} />
  return (
    <>
      <AllenaiLight className={cn('dark:hidden', className)} {...props} />
      <AllenaiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AllenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Allenai, {
  Avatar: AllenaiAvatar,
  colorPrimary: '#F8F0E9'
})

export default AllenaiIcon
