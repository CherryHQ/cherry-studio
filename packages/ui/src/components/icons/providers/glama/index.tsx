import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GlamaAvatar } from './avatar'
import { GlamaDark } from './dark'
import { GlamaLight } from './light'

const Glama = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GlamaLight {...props} className={className} />
  if (variant === 'dark') return <GlamaDark {...props} className={className} />
  return (
    <>
      <GlamaLight className={cn('dark:hidden', className)} {...props} />
      <GlamaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GlamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glama, {
  Avatar: GlamaAvatar,
  colorPrimary: '#000000'
})

export default GlamaIcon
