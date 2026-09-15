import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AnonrouterAvatar } from './avatar'
import { AnonrouterDark } from './dark'
import { AnonrouterLight } from './light'

const Anonrouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AnonrouterLight {...props} className={className} />
  if (variant === 'dark') return <AnonrouterDark {...props} className={className} />
  return (
    <>
      <AnonrouterLight className={cn('dark:hidden', className)} {...props} />
      <AnonrouterDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AnonrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anonrouter, {
  Avatar: AnonrouterAvatar,
  colorPrimary: '#0A0A0A'
})

export default AnonrouterIcon
