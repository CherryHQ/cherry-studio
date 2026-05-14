import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ExaAvatar } from './avatar'
import { ExaDark } from './dark'
import { ExaLight } from './light'

const Exa = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ExaLight {...props} className={className} />
  if (variant === 'dark') return <ExaDark {...props} className={className} />
  return (
    <>
      <ExaLight className={cn('dark:hidden', className)} {...props} />
      <ExaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ExaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Exa, {
  Avatar: ExaAvatar,
  colorPrimary: '#1F40ED'
})

export default ExaIcon
