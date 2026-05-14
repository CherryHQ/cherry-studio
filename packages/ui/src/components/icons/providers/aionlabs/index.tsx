import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AionlabsAvatar } from './avatar'
import { AionlabsDark } from './dark'
import { AionlabsLight } from './light'

const Aionlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AionlabsLight {...props} className={className} />
  if (variant === 'dark') return <AionlabsDark {...props} className={className} />
  return (
    <>
      <AionlabsLight className={cn('dark:hidden', className)} {...props} />
      <AionlabsDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aionlabs, {
  Avatar: AionlabsAvatar,
  colorPrimary: '#0A1B2C'
})

export default AionlabsIcon
