import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DoubaoAvatar } from './avatar'
import { DoubaoDark } from './dark'
import { DoubaoLight } from './light'

const Doubao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DoubaoLight {...props} className={className} />
  if (variant === 'dark') return <DoubaoDark {...props} className={className} />
  return (
    <>
      <DoubaoLight className={cn('dark:hidden', className)} {...props} />
      <DoubaoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DoubaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doubao, {
  Avatar: DoubaoAvatar,
  colorPrimary: '#000000'
})

export default DoubaoIcon
