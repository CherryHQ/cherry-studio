import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DangbeiAvatar } from './avatar'
import { DangbeiDark } from './dark'
import { DangbeiLight } from './light'

const Dangbei = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DangbeiLight {...props} className={className} />
  if (variant === 'dark') return <DangbeiDark {...props} className={className} />
  return (
    <>
      <DangbeiLight className={cn('dark:hidden', className)} {...props} />
      <DangbeiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DangbeiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dangbei, {
  Avatar: DangbeiAvatar,
  colorPrimary: '#000000'
})

export default DangbeiIcon
