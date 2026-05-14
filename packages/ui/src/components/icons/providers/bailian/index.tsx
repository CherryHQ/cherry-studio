import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BailianAvatar } from './avatar'
import { BailianDark } from './dark'
import { BailianLight } from './light'

const Bailian = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BailianLight {...props} className={className} />
  if (variant === 'dark') return <BailianDark {...props} className={className} />
  return (
    <>
      <BailianLight className={cn('dark:hidden', className)} {...props} />
      <BailianDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BailianIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bailian, {
  Avatar: BailianAvatar,
  colorPrimary: '#00EAD1'
})

export default BailianIcon
