import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MetaAvatar } from './avatar'
import { MetaDark } from './dark'
import { MetaLight } from './light'

const Meta = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MetaLight {...props} className={className} />
  if (variant === 'dark') return <MetaDark {...props} className={className} />
  return (
    <>
      <MetaLight className={cn('dark:hidden', className)} {...props} />
      <MetaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MetaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Meta, {
  Avatar: MetaAvatar,
  colorPrimary: '#0081FB'
})

export default MetaIcon
