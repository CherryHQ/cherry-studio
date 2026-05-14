import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NovaAvatar } from './avatar'
import { NovaDark } from './dark'
import { NovaLight } from './light'

const Nova = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NovaLight {...props} className={className} />
  if (variant === 'dark') return <NovaDark {...props} className={className} />
  return (
    <>
      <NovaLight className={cn('dark:hidden', className)} {...props} />
      <NovaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const NovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nova, {
  Avatar: NovaAvatar,
  colorPrimary: '#000000'
})

export default NovaIcon
