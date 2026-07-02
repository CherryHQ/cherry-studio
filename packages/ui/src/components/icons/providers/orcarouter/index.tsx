import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OrcarouterAvatar } from './avatar'
import { OrcarouterDark } from './dark'
import { OrcarouterLight } from './light'

const Orcarouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OrcarouterLight {...props} className={className} />
  if (variant === 'dark') return <OrcarouterDark {...props} className={className} />
  return (
    <>
      <OrcarouterLight className={cn('dark:hidden', className)} {...props} />
      <OrcarouterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OrcarouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Orcarouter, {
  Avatar: OrcarouterAvatar,
  colorPrimary: '#000000'
})

export default OrcarouterIcon
