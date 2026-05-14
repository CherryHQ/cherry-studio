import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PoeAvatar } from './avatar'
import { PoeDark } from './dark'
import { PoeLight } from './light'

const Poe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PoeLight {...props} className={className} />
  if (variant === 'dark') return <PoeDark {...props} className={className} />
  return (
    <>
      <PoeLight className={cn('dark:hidden', className)} {...props} />
      <PoeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PoeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Poe, {
  Avatar: PoeAvatar,
  colorPrimary: '#000000'
})

export default PoeIcon
