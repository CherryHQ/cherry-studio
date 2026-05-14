import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SmitheryAvatar } from './avatar'
import { SmitheryDark } from './dark'
import { SmitheryLight } from './light'

const Smithery = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SmitheryLight {...props} className={className} />
  if (variant === 'dark') return <SmitheryDark {...props} className={className} />
  return (
    <>
      <SmitheryLight className={cn('dark:hidden', className)} {...props} />
      <SmitheryDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SmitheryIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Smithery, {
  Avatar: SmitheryAvatar,
  colorPrimary: '#FF5601'
})

export default SmitheryIcon
