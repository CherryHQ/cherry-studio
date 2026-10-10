import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenrouterAvatar } from './avatar'
import { OpenrouterDark } from './dark'
import { OpenrouterLight } from './light'

const Openrouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenrouterLight {...props} className={className} />
  if (variant === 'dark') return <OpenrouterDark {...props} className={className} />
  return (
    <>
      <OpenrouterLight className={cn('dark:hidden', className)} {...props} />
      <OpenrouterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OpenrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openrouter, {
  Avatar: OpenrouterAvatar,
  colorPrimary: '#000000'
})

export default OpenrouterIcon
