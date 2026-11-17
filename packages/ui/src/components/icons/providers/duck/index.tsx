import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DuckAvatar } from './avatar'
import { DuckDark } from './dark'
import { DuckLight } from './light'

const Duck = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DuckLight {...props} className={className} />
  if (variant === 'dark') return <DuckDark {...props} className={className} />
  return (
    <>
      <DuckLight className={cn('dark:hidden', className)} {...props} />
      <DuckDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DuckIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Duck, {
  Avatar: DuckAvatar,
  colorPrimary: '#14307E'
})

export default DuckIcon
