import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GensparkAvatar } from './avatar'
import { GensparkDark } from './dark'
import { GensparkLight } from './light'

const Genspark = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GensparkLight {...props} className={className} />
  if (variant === 'dark') return <GensparkDark {...props} className={className} />
  return (
    <>
      <GensparkLight className={cn('dark:hidden', className)} {...props} />
      <GensparkDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GensparkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Genspark, {
  Avatar: GensparkAvatar,
  colorPrimary: '#000000'
})

export default GensparkIcon
