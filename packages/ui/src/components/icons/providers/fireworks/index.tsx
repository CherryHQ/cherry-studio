import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FireworksAvatar } from './avatar'
import { FireworksDark } from './dark'
import { FireworksLight } from './light'

const Fireworks = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FireworksLight {...props} className={className} />
  if (variant === 'dark') return <FireworksDark {...props} className={className} />
  return (
    <>
      <FireworksLight className={cn('dark:hidden', className)} {...props} />
      <FireworksDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FireworksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fireworks, {
  Avatar: FireworksAvatar,
  colorPrimary: '#5019C5'
})

export default FireworksIcon
