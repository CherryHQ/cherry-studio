import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WorldrouterAvatar } from './avatar'
import { WorldrouterDark } from './dark'
import { WorldrouterLight } from './light'

const Worldrouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WorldrouterLight {...props} className={className} />
  if (variant === 'dark') return <WorldrouterDark {...props} className={className} />
  return (
    <>
      <WorldrouterLight className={cn('dark:hidden', className)} {...props} />
      <WorldrouterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const WorldrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Worldrouter, {
  Avatar: WorldrouterAvatar,
  colorPrimary: '#000000'
})

export default WorldrouterIcon
