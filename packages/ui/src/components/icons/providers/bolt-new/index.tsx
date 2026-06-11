import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BoltNewAvatar } from './avatar'
import { BoltNewDark } from './dark'
import { BoltNewLight } from './light'

const BoltNew = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BoltNewLight {...props} className={className} />
  if (variant === 'dark') return <BoltNewDark {...props} className={className} />
  return (
    <>
      <BoltNewLight className={cn(className, 'dark:hidden')} {...props} />
      <BoltNewDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const BoltNewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BoltNew, {
  Avatar: BoltNewAvatar,
  colorPrimary: '#000000'
})

export default BoltNewIcon
